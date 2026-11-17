/**
 * Best-effort secret redaction, applied to every session before it leaves the
 * machine (see `runSync`). This is defense in depth, NOT a guarantee: regex
 * cannot find every secret, and it will occasionally redact something harmless.
 * The goal is to keep the common, recognisable credential formats out of the
 * cloud copy. What it does and does not cover is documented in the README.
 *
 * Design rules:
 *  - Pure and idempotent: `redactText(redactText(x)) === redactText(x)`.
 *  - Never throws, never mutates its input.
 *  - Linear time on hostile input. No rule uses an unbounded lazy match across
 *    arbitrary text; private-key blocks are found with `indexOf`, not a regex.
 *  - Replacements are markers like `<REDACTED:github-token>` so a transcript
 *    stays readable and the kind of secret is visible.
 */

import type { CanonicalPart, SessionWithMessages } from "./canonical.js";

export interface RedactionRule {
  /** Stable id, used in the `<REDACTED:name>` marker. */
  readonly name: string;
  /** Global regex. Callers must not rely on `lastIndex`. */
  readonly pattern: RegExp;
  /**
   * Build the replacement. Receives the regex match groups. Defaults to
   * replacing the whole match with the marker.
   */
  readonly replace?: (...groups: string[]) => string;
}

const marker = (name: string): string => `<REDACTED:${name}>`;

/**
 * Regex rules, applied in order. Order matters: specific token formats run
 * before the generic ones so the marker names stay precise (a JWT inside an
 * `Authorization: Bearer` header is reported as a JWT, not a bearer token).
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    // AKIA/ASIA/... followed by 16 upper-case alphanumerics.
    name: "aws-access-key",
    pattern: /(?<![A-Z0-9])(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}(?![A-Z0-9])/g,
  },
  {
    // A 40-char base64-ish string is only treated as an AWS secret key when it
    // sits right after its own name; on its own it is indistinguishable from a
    // git SHA or any other blob.
    name: "aws-secret-key",
    pattern:
      /((?:aws_?secret_?(?:access_?)?key|secret_?access_?key|SecretAccessKey)["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
    replace: (_m, prefix) => `${prefix}${marker("aws-secret-key")}`,
  },
  {
    name: "github-token",
    pattern: /gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255}/g,
  },
  {
    // OpenAI / Anthropic style: sk-..., sk-proj-..., sk-ant-...
    name: "api-key",
    pattern: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "slack-token",
    pattern: /(?<![A-Za-z0-9])xox[abeprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    name: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    // `Bearer <token>`. Requires 16+ token characters including a digit, so the
    // prose "Bearer authentication" is left alone.
    name: "bearer-token",
    pattern: /\b(bearer\s+)(?=[A-Za-z0-9._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: (_m, prefix) => `${prefix}${marker("bearer-token")}`,
  },
  {
    // scheme://user:PASSWORD@host — redact only the password.
    name: "password",
    pattern: /\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/'"]*:)(?!<REDACTED)[^\s@/'"]+(@)/gi,
    replace: (_m, prefix, at) => `${prefix}${marker("password")}${at}`,
  },
  {
    // ENV_STYLE_NAME=value. Upper-case names only (so `const password = f()`
    // in source code is left alone); the value must be 8+ characters with at
    // least one letter and no code punctuation, which skips `$VAR`,
    // `process.env.X`, `getToken()` and already-redacted markers.
    name: "secret-assignment",
    pattern:
      /\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Z0-9_]*["']?\s*[=:]\s*["']?)(?=[^\s"'`(){}<>$,;[\]]*[A-Za-z])[^\s"'`(){}<>$,;[\]]{8,}/g,
    replace: (_m, prefix) => `${prefix}${marker("secret")}`,
  },
];

const PRIVATE_KEY_HEADER = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)-----/g;

/**
 * Replace PEM / PGP private-key blocks. Done with `indexOf` so it is linear
 * however many `BEGIN` markers an input contains. When the matching `END` line
 * is missing (tool output is cut to 500 characters, so this is common) the
 * redaction runs to the end of the text rather than leaving the key body behind.
 */
function redactPrivateKeys(text: string): string {
  if (!text.includes("PRIVATE KEY")) return text;

  const header = new RegExp(PRIVATE_KEY_HEADER.source, "g");
  let out = "";
  let pos = 0;
  let m: RegExpExecArray | null;

  while ((m = header.exec(text)) !== null) {
    const label = m[1] ?? "PRIVATE KEY";
    const endMarker = `-----END ${label}-----`;
    const bodyStart = m.index + m[0].length;
    const endIdx = text.indexOf(endMarker, bodyStart);
    const stop = endIdx === -1 ? text.length : endIdx + endMarker.length;

    out += text.slice(pos, m.index) + marker("private-key");
    pos = stop;
    header.lastIndex = stop;
  }

  return pos === 0 ? text : out + text.slice(pos);
}

/** Redact secrets in a string. Returns the input unchanged when nothing matches. */
export function redactText(text: string): string {
  if (text.length === 0) return text;

  let out = redactPrivateKeys(text);
  for (const rule of REDACTION_RULES) {
    // A fresh RegExp per call: shared /g regexes keep `lastIndex` between uses.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    const build = rule.replace;
    out = build
      ? out.replace(re, (...args: unknown[]) => build(...(args as string[])))
      : out.replace(re, marker(rule.name));
  }
  return out;
}

/**
 * Object keys whose string values are secrets however the value looks, e.g.
 * `{ "AWS_SECRET_ACCESS_KEY": "wJalr…" }` in a tool call's JSON input, where
 * the name and the value are separate strings and the text rules cannot pair
 * them.
 */
const SENSITIVE_KEY =
  /^(?:.*[_-])?(?:password|passwd|secret|secret[_-]?key|access[_-]?key|api[_-]?key|apikey|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|authorization|credentials?)$/i;

/** Redact secrets inside arbitrary JSON (tool-call input). Returns a copy. */
export function redactValue(value: unknown, seen: WeakMap<object, unknown> = new WeakMap()): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;

  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(redactValue(item, seen));
    return copy;
  }

  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    copy[key] =
      typeof v === "string" && v.length > 0 && SENSITIVE_KEY.test(key)
        ? marker("secret")
        : redactValue(v, seen);
  }
  return copy;
}

function redactPart(part: CanonicalPart): CanonicalPart {
  const out: CanonicalPart = { ...part };
  if (part.text !== undefined) out.text = redactText(part.text);
  if (part.output !== undefined) out.output = redactText(part.output);
  if (part.input !== undefined) out.input = redactValue(part.input);
  return out;
}

/**
 * Redact every free-text field a session carries: title, changed-file paths,
 * and each message part's text, tool input and tool output. Ids, timestamps,
 * roles, counts and image data are left as they are. Returns a new object.
 */
export function redactSession(session: SessionWithMessages): SessionWithMessages {
  const out: SessionWithMessages = { ...session };

  if (session.title !== null) out.title = redactText(session.title);
  if (session.filesChanged !== null) out.filesChanged = session.filesChanged.map(redactText);
  out.extensions = redactValue(session.extensions) as Record<string, unknown>;

  if (session.messages !== undefined) {
    out.messages = session.messages.map((m) => ({ ...m, parts: m.parts.map(redactPart) }));
  }
  return out;
}
