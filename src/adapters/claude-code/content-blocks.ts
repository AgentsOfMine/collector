import type { CanonicalPart } from "../../core/canonical.js";

export interface ContentBlockText {
  type: "text";
  text?: string;
}

export interface ContentBlockThinking {
  type: "thinking";
  thinking?: string;
}

export interface ContentBlockToolUse {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ContentBlockToolResult {
  type: "tool_result";
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

export interface ContentBlockImage {
  type: "image";
  source?: {
    type?: string;
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export type ContentBlock =
  | ContentBlockText
  | ContentBlockThinking
  | ContentBlockToolUse
  | ContentBlockToolResult
  | ContentBlockImage
  | { type: string };

export function extractText(content: string | ContentBlock[] | undefined): string | null {
  if (content === undefined) return null;
  if (typeof content === "string") return content;
  for (const block of content) {
    if (block.type === "text") {
      const b = block as ContentBlockText;
      if (typeof b.text === "string") return b.text;
    }
  }
  return null;
}

export function toolResultOutput(block: ContentBlockToolResult): string | undefined {
  const { content } = block;
  if (typeof content === "string") return content.slice(0, 500);
  if (Array.isArray(content)) {
    const texts = content
      .filter((c): c is { type: string; text: string } => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    return texts.slice(0, 500) || undefined;
  }
  return undefined;
}

export function contentBlocksToParts(
  blocks: ContentBlock[],
  toolNameById: Map<string, string>,
): CanonicalPart[] {
  const parts: CanonicalPart[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        const b = block as ContentBlockText;
        if (typeof b.text === "string" && b.text.length > 0) {
          parts.push({ type: "text", text: b.text });
        }
        break;
      }
      case "thinking": {
        const b = block as ContentBlockThinking;
        if (typeof b.thinking === "string" && b.thinking.length > 0) {
          parts.push({ type: "reasoning", text: b.thinking });
        }
        break;
      }
      case "tool_use": {
        const b = block as ContentBlockToolUse;
        if (b.id && b.name) {
          toolNameById.set(b.id, b.name);
          parts.push({
            type: "tool",
            tool: b.name,
            callId: b.id,
            input: b.input,
          });
        }
        break;
      }
      case "tool_result": {
        const b = block as ContentBlockToolResult;
        if (b.tool_use_id) {
          const name = toolNameById.get(b.tool_use_id) ?? "unknown";
          parts.push({
            type: "tool",
            tool: name,
            callId: b.tool_use_id,
            output: toolResultOutput(b),
          });
        }
        break;
      }
      case "image": {
        const b = block as ContentBlockImage;
        const src = b.source;
        if (src) {
          if (src.type === "base64" && src.data) {
            parts.push({
              type: "image_url",
              mediaType: src.media_type,
              imageUrl: `data:${src.media_type ?? "image/png"};base64,${src.data.slice(0, 64)}…`,
            });
          } else if (src.url) {
            parts.push({ type: "image_url", imageUrl: src.url, mediaType: src.media_type });
          }
        }
        break;
      }
    }
  }
  return parts;
}
