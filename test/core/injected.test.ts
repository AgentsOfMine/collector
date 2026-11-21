import { describe, it, expect } from "vitest";
import { annotateMessage, annotateSession, splitInjected, syntheticLabel } from "../../src/core/injected.js";
import type { CanonicalMessage, SessionWithMessages } from "../../src/core/canonical.js";

const user = (...texts: string[]): CanonicalMessage => ({
  messageId: "m1",
  sessionId: "s1",
  role: "user",
  senderName: "You",
  createdAt: "2026-11-21T10:00:00Z",
  parts: texts.map((text) => ({ type: "text", text })),
});
const joined = (m: CanonicalMessage) => m.parts.map((p) => p.text ?? "").join("\n");

const REMINDER = "<system-reminder>\nAs you answer, use the project rules.\n</system-reminder>";
const AGENTS = "# AGENTS.md instructions for /work/app\n\n<INSTRUCTIONS>\nBe brief.\n</INSTRUCTIONS>";
const ANALYZE = [
  "[analyze-mode]",
  "ANALYSIS MODE. Gather context first:",
  "- one",
  "---",
  "MANDATORY delegate_task params: ALWAYS include load_skills",
  "Example: delegate_task(...)",
  "",
  "---",
].join("\n");
const SEARCH_ANALYZE = ["[search-mode]", "MAXIMIZE SEARCH EFFORT.", "", "[analyze-mode]", "ANALYSIS MODE.", "---", "MANDATORY delegate_task params: x", "", "---"].join("\n");
const SEARCH_ONLY = ["[search-mode]", "MAXIMIZE SEARCH EFFORT.", "---"].join("\n");

describe("annotateMessage — wrapped context blocks", () => {
  it("labels a closed <system-reminder> that is the whole message", () => {
    const m = annotateMessage(user(REMINDER));
    expect(m.parts).toEqual([{ type: "text", text: REMINDER, meta: "system-reminder" }]);
  });

  it("splits a reminder from the words typed after it", () => {
    const m = annotateMessage(user(`${REMINDER}\n\nFix the login bug`));
    expect(m.parts).toEqual([
      { type: "text", text: REMINDER, meta: "system-reminder" },
      { type: "text", text: "Fix the login bug" },
    ]);
  });

  it("labels the AGENTS.md block a coding agent adds", () => {
    const m = annotateMessage(user(AGENTS));
    expect(m.parts[0]).toMatchObject({ meta: "AGENTS.md", text: AGENTS });
  });

  it("handles several blocks in a row and names each once", () => {
    const m = annotateMessage(user(`${AGENTS}\n${REMINDER}\n${REMINDER}\nhello`));
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0]?.meta).toBe("AGENTS.md · system-reminder");
    expect(m.parts[1]).toEqual({ type: "text", text: "hello" });
  });

  it("leaves an unclosed tag alone (a person may have pasted HTML)", () => {
    const text = "<system-reminder>\nnever closed";
    expect(annotateMessage(user(text))).toEqual(user(text));
  });

  it("leaves unknown tags alone", () => {
    const text = "<div>hello</div>";
    expect(annotateMessage(user(text))).toEqual(user(text));
  });

  it("only looks at the start of the text", () => {
    const text = `please look at this:\n${REMINDER}`;
    expect(annotateMessage(user(text))).toEqual(user(text));
  });

  it("labels the AGENTS.md start only when its end tag is there", () => {
    const text = "# AGENTS.md instructions for /x\n\nno end tag";
    expect(annotateMessage(user(text))).toEqual(user(text));
  });
});

describe("annotateMessage — the OpenCode plugin's mode header", () => {
  it("cuts after the boilerplate paragraph and keeps the user's words clean", () => {
    const m = annotateMessage(user(`${ANALYZE}\nWhy does the build fail?`));
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0]).toMatchObject({ meta: "analyze-mode" });
    expect(m.parts[0]?.text).toBe(ANALYZE);
    expect(m.parts[1]).toEqual({ type: "text", text: "Why does the build fail?" });
  });

  it("names both modes when the header has two", () => {
    expect(annotateMessage(user(`${SEARCH_ANALYZE}\nfind it`)).parts[0]?.meta).toBe("search-mode · analyze-mode");
  });

  it("cuts at the first divider when there is no boilerplate paragraph", () => {
    const m = annotateMessage(user(`${SEARCH_ONLY}\nlook for x`));
    expect(m.parts[0]).toMatchObject({ meta: "search-mode", text: SEARCH_ONLY });
    expect(m.parts[1]?.text).toBe("look for x");
  });

  it("does not swallow the user's own dividers (the app's old rule did)", () => {
    const typed = ["Here is my list:", "---", "one", "---", "two", "---", "three"].join("\n");
    const m = annotateMessage(user(`${SEARCH_ONLY}\n${typed}`));
    expect(m.parts[1]?.text).toBe(typed);
  });

  it("leaves a message that only mentions [analyze-mode] later on", () => {
    const text = "what does [analyze-mode] do?\n---\nthanks";
    expect(annotateMessage(user(text))).toEqual(user(text));
  });

  it("leaves a mode header with no divider alone", () => {
    const text = "[analyze-mode]\nno divider anywhere";
    expect(annotateMessage(user(text))).toEqual(user(text));
  });
});

describe("annotateMessage — safety", () => {
  it("does not touch assistant messages", () => {
    const a: CanonicalMessage = { ...user(REMINDER), role: "assistant" };
    expect(annotateMessage(a)).toBe(a);
  });

  it("does not touch non-text parts, or parts that already carry a label", () => {
    const m: CanonicalMessage = {
      ...user(),
      parts: [{ type: "tool", tool: "bash", output: REMINDER }, { type: "text", text: REMINDER, meta: "injected" }],
    };
    expect(annotateMessage(m)).toBe(m);
  });

  it("returns the same object when nothing matches", () => {
    const m = user("a plain question", "and a second plain part");
    expect(annotateMessage(m)).toBe(m);
  });

  it("never changes the words: parts joined read the same, apart from trimming the cut", () => {
    for (const text of [`${REMINDER}\n\nFix it`, `${ANALYZE}\nWhy?`, `${AGENTS}\n${REMINDER}\nhi`]) {
      const before = user(text);
      const after = annotateMessage(before);
      expect(joined(after).replace(/\s+/g, " ").trim()).toBe(joined(before).replace(/\s+/g, " ").trim());
    }
  });

  it("is idempotent", () => {
    const once = annotateMessage(user(`${REMINDER}\nhello`));
    expect(annotateMessage(once)).toBe(once);
  });

  it("is linear on a long message and on hostile input", () => {
    const t0 = Date.now();
    annotateMessage(user("<system-reminder>".repeat(20_000)));
    annotateMessage(user("[analyze-mode]\n" + "---\n".repeat(50_000)));
    annotateMessage(user("# AGENTS.md instructions for x" + "<INSTRUCTIONS>".repeat(20_000)));
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe("syntheticLabel", () => {
  it("keeps names from a short fixed list and is generic for everything else", () => {
    expect(syntheticLabel("[SYSTEM DIRECTIVE: OH-MY-OPENCODE - x]\nrest")).toBe("SYSTEM DIRECTIVE");
    expect(syntheticLabel("[MEMORY]\nsomething")).toBe("MEMORY");
    expect(syntheticLabel("<system-reminder>\nx\n</system-reminder>")).toBe("system-reminder");
    expect(syntheticLabel("Called the Read tool with the following input: {}")).toBe("injected");
    expect(syntheticLabel("<path>/a/b</path>")).toBe("injected");
    expect(syntheticLabel("<some-secret-looking-tag>x</some-secret-looking-tag>")).toBe("injected");
  });
});

describe("annotateSession", () => {
  it("returns the same session when nothing changed, and a new one when something did", () => {
    const plain: SessionWithMessages = { ...base(), messages: [user("hello")] };
    expect(annotateSession(plain)).toBe(plain);
    const withReminder: SessionWithMessages = { ...base(), messages: [user(`${REMINDER}\nhello`)] };
    expect(annotateSession(withReminder).messages?.[0]?.parts[0]?.meta).toBe("system-reminder");
    expect(withReminder.messages?.[0]?.parts).toHaveLength(1);
  });

  it("copes with a session that has no messages", () => {
    const s = base();
    expect(annotateSession(s)).toBe(s);
  });
});

describe("splitInjected", () => {
  it("returns null for plain text", () => {
    expect(splitInjected("just words")).toBeNull();
  });
});

function base(): SessionWithMessages {
  return {
    sessionId: "s1", provider: "opencode", projectId: "p", projectPath: "/p", agentName: "OpenCode", title: null, modelLine: null,
    startedAt: "2026-11-21T10:00:00Z", endedAt: null, messageCount: null, fileCount: null, linesAdded: null, linesRemoved: null,
    filesChanged: null, filesChangedApproximate: false, extensions: {},
  };
}
