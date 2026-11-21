import { describe, it, expect } from "vitest";
import {
  redactText,
  redactValue,
  redactSession,
  REDACTION_RULES,
} from "../../src/core/redact.js";
import type { SessionWithMessages } from "../../src/core/canonical.js";

// Secrets below are FAKE and assembled at runtime so this file does not itself
// trip secret scanners (GitHub push protection, gitleaks, ...).
const fake = (...parts: string[]) => parts.join("");
const AWS_KEY = fake("AKIA", "IOSFODNN7EXAMPLE");
const AWS_SECRET = fake("wJalrXUtnFEMI/K7MDENG", "/bPxRfiCYEXAMPLEKEY");
const GH_PAT = fake("ghp_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");
const SK_KEY = fake("sk-", "proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56");
const SLACK = fake("xox", "b-1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx");
const JWT = fake(
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  ".",
  "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ",
  ".",
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
);
const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun",
  "VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

describe("redactText — secrets that must go", () => {
  it("redacts AWS access key ids", () => {
    const out = redactText(`key is ${AWS_KEY} ok`);
    expect(out).not.toContain(AWS_KEY);
    expect(out).toContain("<REDACTED:aws-access-key>");
    expect(out).toContain("key is ");
    expect(out).toContain(" ok");
  });

  it("redacts an AWS secret key only when it sits next to its context", () => {
    const withContext = redactText(`aws_secret_access_key = ${AWS_SECRET}`);
    expect(withContext).not.toContain(AWS_SECRET);
    expect(withContext).toContain("<REDACTED:aws-secret-key>");
    expect(withContext).toContain("aws_secret_access_key");
  });

  it("redacts GitHub tokens, OpenAI-style keys and Slack tokens", () => {
    expect(redactText(`token: ${GH_PAT}`)).toContain("<REDACTED:github-token>");
    expect(redactText(`OPENAI_API_KEY=${SK_KEY}`)).not.toContain(SK_KEY);
    expect(redactText(`slack ${SLACK}`)).toContain("<REDACTED:slack-token>");
    expect(redactText(`slack ${SLACK}`)).not.toContain(SLACK);
  });

  it("redacts JWT-shaped strings", () => {
    const out = redactText(`Authorization: Bearer ${JWT}`);
    expect(out).not.toContain(JWT);
    expect(out).toContain("<REDACTED:jwt>");
  });

  it("redacts a whole PEM private key block, including its body", () => {
    const out = redactText(`here:\n${PEM}\nthanks`);
    expect(out).not.toContain("MIIEowIBAAKCAQEA");
    expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(out).toContain("<REDACTED:private-key>");
    expect(out).toContain("here:");
    expect(out).toContain("thanks");
  });

  it("redacts the password in a connection string but keeps the rest readable", () => {
    const out = redactText("DATABASE_URL=postgres://admin:hunter2pass@db.internal:5432/app");
    expect(out).not.toContain("hunter2pass");
    expect(out).toContain("postgres://admin:<REDACTED:password>@db.internal:5432/app");
  });

  it("redacts a password that has no username (redis-style URLs)", () => {
    const out = redactText("REDIS=redis://:onlypassword@cache.internal:6379/0");
    expect(out).not.toContain("onlypassword");
    expect(out).toContain("redis://:<REDACTED:password>@cache.internal:6379/0");
  });

  it("redacts secrets assigned to ENV_STYLE names", () => {
    expect(redactText("DB_PASSWORD=correct-horse-battery")).toBe("DB_PASSWORD=<REDACTED:secret>");
    expect(redactText('export STRIPE_API_KEY="pk_live_51Habcdefghijklmn"')).toContain("<REDACTED:secret>");
  });

  it("leaves code that merely mentions secret-like names", () => {
    for (const code of [
      "const password = req.body.password;",
      "const token = getToken();",
      "API_KEY=$API_KEY",
      "SECRET_TOKEN=${SECRET_TOKEN}",
      "const k = process.env.OPENAI_API_KEY;",
      "API_KEY=your_api_key_here",
      "PASSWORD=abc",
      "Use Bearer authentication for the API",
    ]) {
      expect(redactText(code)).toBe(code);
    }
  });

  it("redacts an unterminated private key (tool output is cut at 500 chars)", () => {
    const out = redactText("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU");
    expect(out).toBe("<REDACTED:private-key>");
  });

  it("redacts bearer tokens in Authorization headers", () => {
    const out = redactText("curl -H 'Authorization: Bearer abcDEF1234567890xyz_-.~+/=' https://x");
    expect(out).not.toContain("abcDEF1234567890xyz");
    expect(out).toContain("<REDACTED:bearer-token>");
  });

  it("redacts several secrets in one string", () => {
    const out = redactText(`${AWS_KEY} and ${GH_PAT}`);
    expect(out).toContain("<REDACTED:aws-access-key>");
    expect(out).toContain("<REDACTED:github-token>");
  });
});

describe("redactText — vendor tokens, basic auth, query secrets, key/value pairs", () => {
  const rnd = (n: number) => "aB3dE5gH7jK9mN1pQ3sT5vX7zC9eF2hJ4kL6nR8".repeat(3).slice(0, n);

  it("redacts prefixed vendor tokens", () => {
    for (const tok of [
      fake("AI", "za", rnd(35)),
      fake("sk_", "live_", rnd(24)),
      fake("rk_", "live_", rnd(24)),
      fake("glp", "at-", rnd(20)),
      fake("npm", "_", rnd(36)),
      fake("hf", "_", rnd(34)),
      fake("SG", ".", rnd(22), ".", rnd(43)),
      fake("da", "pi", "0123456789abcdef0123456789abcdef"),
      fake("GOC", "SPX-", rnd(28)),
    ]) {
      expect(redactText(`use ${tok} now`)).toBe("use <REDACTED:service-token> now");
    }
  });

  it("redacts chat webhook addresses", () => {
    expect(redactText(fake("https://hooks.slack.com/services/", "T0123ABCD/B0123ABCD/", rnd(24)))).toBe("<REDACTED:webhook-url>");
    expect(redactText(fake("https://discord.com/api/webhooks/", "123456789012345678/", rnd(60)))).toBe("<REDACTED:webhook-url>");
  });

  it("redacts basic-auth headers and curl -u passwords but keeps the user name", () => {
    expect(redactText("Authorization: Basic ZGVwbG95OnMzY3IzdFBhc3M=")).toBe("Authorization: Basic <REDACTED:basic-auth>");
    expect(redactText("curl -u admin:s3cr3tPass https://x.invalid")).toBe("curl -u admin:<REDACTED:basic-auth> https://x.invalid");
    expect(redactText("curl -u admin:$PASSWORD https://x.invalid")).toBe("curl -u admin:$PASSWORD https://x.invalid");
  });

  it("redacts a secret in a URL query but leaves placeholders", () => {
    expect(redactText(`https://a.invalid/v1?access_token=${rnd(32)}&x=1`)).toBe("https://a.invalid/v1?access_token=<REDACTED:query-secret>&x=1");
    expect(redactText("https://a.invalid/v1?token=${TOKEN}")).toBe("https://a.invalid/v1?token=${TOKEN}");
    expect(redactText("https://a.invalid/v1?token=abcdefghijklmnop")).toBe("https://a.invalid/v1?token=abcdefghijklmnop");
  });

  it("redacts name/value pairs in JSON, YAML and shell, in any case", () => {
    expect(redactText(`{"api_key": "${rnd(32)}", "name": "x"}`)).toBe('{"api_key": "<REDACTED:secret>", "name": "x"}');
    expect(redactText(`db_password=${rnd(16)}`)).toBe("db_password=<REDACTED:secret>");
    expect(redactText(`token: ${rnd(32)}`)).toBe("token: <REDACTED:secret>");
    expect(redactText(`AccountKey=${rnd(60)}==;EndpointSuffix=x`)).toContain("<REDACTED:secret>");
  });

  it("redacts secret-bearing headers and flags", () => {
    expect(redactText(`-H "x-api-key: ${rnd(32)}"`)).toBe('-H "x-api-key: <REDACTED:secret>"');
    expect(redactText(`mysql --password=${rnd(14)} -u root`)).toBe("mysql --password=<REDACTED:secret> -u root");
    expect(redactText("pytest --password hunter2-xyz1")).toBe("pytest --password <REDACTED:secret>");
  });

  it("leaves names, types, prose and ARNs that only mention secrets", () => {
    for (const text of [
      "token: string",
      "tokenizer: 'bert-base-uncased-vocab'",
      "the token budget is high and the password policy changed",
      "arn:aws:secretsmanager:eu-central-1:123456789012:secret:prod/db-AbC123",
      "const password = process.env.DB_PASSWORD_VALUE;",
      "password: ${DB_PASSWORD}",
      "api_key: <your key here>",
      "--password",
      "pass --password option to the script",
      "curl -u admin https://x.invalid",
    ]) {
      expect(redactText(text)).toBe(text);
    }
  });

  it("is idempotent for the new rules", () => {
    const text = `curl -u a:s3cr3tPass "https://x.invalid?token=${rnd(30)}" -H "x-api-key: ${rnd(30)}" api_key=${rnd(30)}`;
    expect(redactText(redactText(text))).toBe(redactText(text));
  });
});

describe("redactText — ordinary text must be left alone", () => {
  const harmless = [
    "const sk = require('./sk-utils')",
    "The ask-me-anything session with sk-learn docs",
    "git commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    "uuid 123e4567-e89b-12d3-a456-426614174000",
    "https://example.com/path?x=1&y=2",
    "postgres://localhost:5432/app",
    "postgres://user@host/db",
    "const password = getPassword();",
    "AKIA is the prefix AWS uses",
    "ghp_ is a prefix",
    "eyJ is how base64 JSON starts",
    "-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAL\n-----END PUBLIC KEY-----",
    "/Users/dev/Projects/my-app/src/index.ts",
    "base64 data: SGVsbG8gV29ybGQ=",
    "",
  ];

  it.each(harmless)("leaves %j unchanged", (text) => {
    expect(redactText(text)).toBe(text);
  });

  it("does not touch a 40-char string with no AWS context", () => {
    const sha = "9fceb02d0ae598e95dc970b74767f19372d61af8";
    expect(redactText(`commit ${sha}`)).toBe(`commit ${sha}`);
    const b64ish = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    expect(redactText(`value ${b64ish}`)).toBe(`value ${b64ish}`);
  });
});

describe("redactText — behaviour", () => {
  it("is idempotent", () => {
    const once = redactText(`${AWS_KEY} ${GH_PAT} ${PEM}`);
    expect(redactText(once)).toBe(once);
  });

  it("returns the identical string when there is nothing to redact", () => {
    const s = "nothing secret here";
    expect(redactText(s)).toBe(s);
  });

  it("exposes a rule list with unique names and no stateful regexes", () => {
    const names = REDACTION_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const rule of REDACTION_RULES) {
      // A /g regex reused across calls keeps lastIndex; the implementation must
      // be safe to call repeatedly regardless.
      expect(redactText(`x ${AWS_KEY}`)).toContain("<REDACTED:");
      expect(rule.pattern).toBeInstanceOf(RegExp);
    }
  });

  it("handles a very long input without catastrophic backtracking", () => {
    const big = "a".repeat(200_000) + AWS_KEY + "b".repeat(200_000);
    const t0 = Date.now();
    const out = redactText(big);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(out).toContain("<REDACTED:aws-access-key>");
  });

  it("handles pathological near-matches in linear time", () => {
    const nasty = "-----BEGIN PRIVATE KEY-----".repeat(2000) + "x".repeat(50_000);
    const t0 = Date.now();
    redactText(nasty);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe("redactValue — arbitrary JSON (tool input)", () => {
  it("redacts strings at any depth and leaves structure intact", () => {
    const input = {
      command: `curl -u admin:pw ${GH_PAT}`,
      nested: { list: ["ok", `export KEY=${AWS_KEY}`, 3, null, true] },
    };
    const out = redactValue(input) as typeof input;
    expect(JSON.stringify(out)).not.toContain(GH_PAT);
    expect(JSON.stringify(out)).not.toContain(AWS_KEY);
    expect(out.nested.list[0]).toBe("ok");
    expect(out.nested.list[2]).toBe(3);
    expect(out.nested.list[3]).toBeNull();
    expect(out.nested.list[4]).toBe(true);
  });

  it("does not mutate its argument", () => {
    const input = { a: `k=${AWS_KEY}` };
    const copy = JSON.parse(JSON.stringify(input));
    redactValue(input);
    expect(input).toEqual(copy);
  });

  it("passes non-string primitives and undefined through", () => {
    expect(redactValue(undefined)).toBeUndefined();
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBeNull();
  });

  it("survives a cyclic structure instead of overflowing the stack", () => {
    const a: Record<string, unknown> = { s: `k=${AWS_KEY}` };
    a["self"] = a;
    expect(() => redactValue(a)).not.toThrow();
  });
});

function session(overrides: Partial<SessionWithMessages> = {}): SessionWithMessages {
  return {
    sessionId: "s1",
    provider: "opencode",
    projectId: "p",
    projectPath: "/home/u/proj",
    agentName: "OpenCode",
    title: `fix with ${AWS_KEY}`,
    modelLine: "m",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: null,
    messageCount: 1,
    fileCount: null,
    linesAdded: null,
    linesRemoved: null,
    filesChanged: [`/home/u/proj/.env.${GH_PAT}`],
    filesChangedApproximate: false,
    extensions: {},
    messages: [
      {
        messageId: "m1",
        sessionId: "s1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:01Z",
        parts: [
          { type: "text", text: `my key ${AWS_KEY}` },
          { type: "reasoning", text: `think about ${GH_PAT}` },
          { type: "tool", tool: "bash", callId: "c1", input: { command: `echo ${SK_KEY}` }, output: `got ${SLACK}` },
          { type: "image_url", imageUrl: "data:image/png;base64,AAAA…", mediaType: "image/png" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("redactSession", () => {
  it("redacts every text-bearing field a session carries", () => {
    const out = JSON.stringify(redactSession(session()));
    for (const secret of [AWS_KEY, GH_PAT, SK_KEY, SLACK]) {
      expect(out).not.toContain(secret);
    }
  });

  it("redacts the title and the changed-file paths too", () => {
    const out = redactSession(session());
    expect(out.title).not.toContain(AWS_KEY);
    expect(out.filesChanged?.[0]).not.toContain(GH_PAT);
  });

  it("does not mutate the input session", () => {
    const s = session();
    const before = JSON.stringify(s);
    redactSession(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("keeps ids, timestamps, roles and counts untouched", () => {
    const s = session();
    const out = redactSession(s);
    expect(out.sessionId).toBe(s.sessionId);
    expect(out.startedAt).toBe(s.startedAt);
    expect(out.messages?.[0]?.messageId).toBe("m1");
    expect(out.messages?.[0]?.role).toBe("assistant");
    expect(out.messages?.[0]?.createdAt).toBe("2026-01-01T00:00:01Z");
    expect(out.messageCount).toBe(1);
    expect(out.provider).toBe("opencode");
  });

  it("keeps the image part intact", () => {
    const out = redactSession(session());
    expect(out.messages?.[0]?.parts[3]).toEqual({
      type: "image_url",
      imageUrl: "data:image/png;base64,AAAA…",
      mediaType: "image/png",
    });
  });

  it("handles a session with no messages and null fields", () => {
    const s = session({ messages: undefined, title: null, filesChanged: null });
    const out = redactSession(s);
    expect(out.messages).toBeUndefined();
    expect(out.title).toBeNull();
    expect(out.filesChanged).toBeNull();
  });
});
