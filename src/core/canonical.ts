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

export const SyncRequestSchema = z.object({
  deviceId: z.string(),
  collectorVersion: z.string(),
  sentAt: z.string(),
  sessions: z.array(CanonicalSessionSchema),
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
