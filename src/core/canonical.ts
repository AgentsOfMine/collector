import { z } from "zod";
import { KNOWN_PROVIDERS, isKnownProvider } from "./providers.js";

export const ProjectIdentitySchema = z.object({
  kind: z.enum(["git", "path-legacy"]),
  canonical: z.string(),
  displayName: z.string(),
  git: z
    .object({
      root: z.string(),
      remoteName: z.string(),
      remoteUrl: z.string(),
      branch: z.string().nullable(),
      headCommit: z.string().nullable(),
    })
    .optional(),
  local: z.object({
    path: z.string(),
    basename: z.string(),
  }),
});

export type ProjectIdentity = z.infer<typeof ProjectIdentitySchema>;

export const CanonicalSessionSchema = z.object({
  sessionId: z.string(),
  // Allowlist is data-driven via providers.json (see ./providers.ts), not a hardcoded enum.
  provider: z.string().refine(isKnownProvider, {
    message: `provider must be one of: ${KNOWN_PROVIDERS.join(", ")}`,
  }),
  projectId: z.string(),
  projectPath: z.string(),
  projectIdentity: ProjectIdentitySchema.optional(),
  agentName: z.string(),
  title: z.string().nullable(),
  modelLine: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  messageCount: z.number().int().nullable(),
  fileCount: z.number().int().nullable(),
  linesAdded: z.number().int().nullable(),
  linesRemoved: z.number().int().nullable(),
  filesChanged: z.array(z.string()).nullable(),
  filesChangedApproximate: z.boolean(),
  extensions: z.record(z.unknown()),
});

export type CanonicalSession = z.infer<typeof CanonicalSessionSchema>;

export const CanonicalPartSchema = z.object({
  type: z.string(),
  // text / reasoning / thinking blocks
  text: z.string().optional(),
  // tool_use / tool_result blocks
  tool: z.string().optional(),
  callId: z.string().optional(),
  input: z.unknown().optional(),
  output: z.string().optional(),
  // image blocks (type === "image_url")
  imageUrl: z.string().optional(),
  mediaType: z.string().optional(),
});

export type CanonicalPart = z.infer<typeof CanonicalPartSchema>;

export const CanonicalMessageSchema = z.object({
  messageId: z.string(),
  sessionId: z.string(),
  role: z.enum(["user", "assistant"]),
  senderName: z.string().optional(),
  createdAt: z.string(),
  parts: z.array(CanonicalPartSchema),
});

export type CanonicalMessage = z.infer<typeof CanonicalMessageSchema>;

export const SessionWithMessagesSchema = CanonicalSessionSchema.extend({
  messages: z.array(CanonicalMessageSchema).optional(),
});

export type SessionWithMessages = z.infer<typeof SessionWithMessagesSchema>;

export const SyncRequestSchema = z.object({
  deviceId: z.string(),
  collectorVersion: z.string(),
  sentAt: z.string(),
  sessions: z.array(SessionWithMessagesSchema),
});

export type SyncRequest = z.infer<typeof SyncRequestSchema>;

export const SyncResponseSchema = z.object({
  accepted: z.array(z.string()),
  rejected: z.array(z.object({ sessionId: z.string(), reason: z.string() })),
});

export type SyncResponse = z.infer<typeof SyncResponseSchema>;

export function validateSession(raw: unknown): CanonicalSession {
  return CanonicalSessionSchema.parse(raw);
}
