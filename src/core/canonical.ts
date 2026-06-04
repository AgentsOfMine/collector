import { z } from "zod";

export const CanonicalSessionSchema = z.object({
  sessionId: z.string(),
  provider: z.enum(["claude-code", "opencode", "codex"]),
  projectId: z.string(),
  projectPath: z.string(),
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
  text: z.string().optional(),
  tool: z.string().optional(),
  callId: z.string().optional(),
  input: z.unknown().optional(),
  output: z.string().optional(),
});

export type CanonicalPart = z.infer<typeof CanonicalPartSchema>;

export const CanonicalMessageSchema = z.object({
  messageId: z.string(),
  sessionId: z.string(),
  role: z.enum(["user", "assistant"]),
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
