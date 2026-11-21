/**
 * Mark text that a tool put into a "user" message, as opposed to what the person typed.
 *
 * A text part with `meta: "<label>"` was injected (a system reminder, the AGENTS.md block a coding agent adds, an
 * OpenCode plugin's mode header, a part OpenCode itself flags as synthetic). The text is unchanged; only the label is
 * added, and a header that sits in front of the user's own words is split into its own part so the words stay clean.
 *
 * Rules that keep this safe:
 *  - Only user messages, only text parts, only patterns from a fixed list. Nothing is guessed from a bare `[word]` or
 *    `<word>`, because people paste shell prompts and HTML.
 *  - A label is always one of the fixed names below, never copied from the message, so it cannot carry anything private.
 *  - When a pattern is not matched exactly, the text is left alone. A miss shows plugin text as if typed; it never
 *    hides what the person typed.
 *  - Idempotent, never throws, never changes the text itself (the parts, joined, read the same as before).
 */

import type { CanonicalMessage, CanonicalPart, SessionWithMessages } from "./canonical.js";

/** Tags that harnesses wrap around injected context. Each must be closed, or it is not treated as injected. */
const WRAPPED_TAGS = new Set([
  "system-reminder",
  "environment_context",
  "auto-slash-command",
  "external_codex_apps_writing_block_edits",
  "recommended_plugins",
  "in-app-browser-context",
  "local-command-caveat",
  "local-command-stdout",
  "local-command-stderr",
  "task-notification",
]);

const AGENTS_MD_START = "# AGENTS.md instructions for";
const AGENTS_MD_END = "</INSTRUCTIONS>";
const MODE_HEADER = /^\s*\[(analyze-mode|search-mode)\]/;
const DIVIDER = /^\s*-{3,}\s*$/;
const PLUGIN_BOILERPLATE = "MANDATORY delegate_task params";

export const SYNTHETIC_LABEL = "injected";
export const SYSTEM_NOTE_LABEL = "system note";

/** Label for a part an agent flagged as synthetic. Known harness tags keep their name; anything else is generic. */
export function syntheticLabel(text: string): string {
  const head = text.trimStart();
  if (head.startsWith("[SYSTEM DIRECTIVE")) return "SYSTEM DIRECTIVE";
  if (head.startsWith("[MEMORY")) return "MEMORY";
  const tag = /^<([A-Za-z][A-Za-z0-9_-]*)>/.exec(head)?.[1];
  if (tag !== undefined && WRAPPED_TAGS.has(tag)) return tag;
  return SYNTHETIC_LABEL;
}

interface Split {
  /** Text up to where the injected part ends, exactly as it is. */
  header: string;
  /** What follows (may be empty). */
  body: string;
  label: string;
}

/** A run of closed, known wrapper tags (and the AGENTS.md block) at the very start of the text. */
function leadingBlocks(text: string): Split | null {
  let pos = 0;
  const labels: string[] = [];
  for (;;) {
    const rest = text.slice(pos);
    const lead = rest.length - rest.trimStart().length;
    const at = pos + lead;
    if (text.startsWith(AGENTS_MD_START, at)) {
      const close = text.indexOf(AGENTS_MD_END, at);
      if (close === -1) break;
      pos = close + AGENTS_MD_END.length;
      labels.push("AGENTS.md");
      continue;
    }
    const open = /^<([A-Za-z][A-Za-z0-9_-]*)>/.exec(text.slice(at, at + 80));
    const tag = open?.[1];
    if (tag === undefined || !WRAPPED_TAGS.has(tag)) break;
    const closeTag = `</${tag}>`;
    const close = text.indexOf(closeTag, at + open![0].length);
    if (close === -1) break;
    pos = close + closeTag.length;
    labels.push(tag);
  }
  if (labels.length === 0) return null;
  return { header: text.slice(0, pos).trim(), body: text.slice(pos).trim(), label: [...new Set(labels)].join(" · ") };
}

/**
 * OpenCode's oh-my-opencode plugin writes `[analyze-mode]` / `[search-mode]` sections, then a `---` divider, in front
 * of the user's words. In the three templates seen the header ends at the first divider, or at the second when the
 * first is followed by the plugin's own "MANDATORY delegate_task params" paragraph.
 */
function modeHeader(text: string): Split | null {
  if (!MODE_HEADER.test(text)) return null;
  const lines = text.split("\n");
  const dividers: number[] = [];
  lines.forEach((l, i) => {
    if (DIVIDER.test(l)) dividers.push(i);
  });
  const first = dividers[0];
  if (first === undefined) return null;
  let end = first;
  const next = lines.slice(first + 1).find((l) => l.trim() !== "");
  const second = dividers[1];
  if (next?.startsWith(PLUGIN_BOILERPLATE) === true && second !== undefined) end = second;

  const names = new Set<string>();
  for (const line of lines.slice(0, end)) {
    const m = MODE_HEADER.exec(line);
    if (m?.[1] !== undefined) names.add(m[1]);
  }
  return {
    header: lines.slice(0, end + 1).join("\n").trim(),
    body: lines.slice(end + 1).join("\n").trim(),
    label: [...names].join(" · "),
  };
}

/** Split one user text into an injected header and the person's own words, or null when nothing matches. */
export function splitInjected(text: string): Split | null {
  return leadingBlocks(text) ?? modeHeader(text);
}

function annotateParts(parts: CanonicalPart[]): CanonicalPart[] {
  const out: CanonicalPart[] = [];
  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string" || part.meta !== undefined) {
      out.push(part);
      continue;
    }
    const split = splitInjected(part.text);
    if (split === null) {
      out.push(part);
      continue;
    }
    out.push({ ...part, text: split.header, meta: split.label });
    if (split.body !== "") out.push({ ...part, text: split.body });
  }
  return out;
}

export function annotateMessage(message: CanonicalMessage): CanonicalMessage {
  if (message.role !== "user") return message;
  const parts = annotateParts(message.parts);
  return parts.length === message.parts.length && parts.every((p, i) => p === message.parts[i]) ? message : { ...message, parts };
}

/** Annotate every user message of a session. Returns the same object when nothing changed. */
export function annotateSession(session: SessionWithMessages): SessionWithMessages {
  if (session.messages === undefined) return session;
  const messages = session.messages.map(annotateMessage);
  return messages.every((m, i) => m === session.messages?.[i]) ? session : { ...session, messages };
}
