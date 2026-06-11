import type { CanonicalMessage } from "./canonical.js";

/** Maximum messages kept per session before truncation. */
export const MAX_MESSAGES_PER_SESSION = 150;

/**
 * Cap a session's messages: keep the first message plus the most recent
 * (MAX_MESSAGES_PER_SESSION - 1) when the count exceeds the limit, so the
 * opening context and the latest activity are both preserved.
 */
export function truncateMessages(messages: CanonicalMessage[]): CanonicalMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_SESSION) return messages;
  return [...messages.slice(0, 1), ...messages.slice(-(MAX_MESSAGES_PER_SESSION - 1))];
}
