import { describe, it, expect } from "vitest";
import { extractFiles } from "../../../src/adapters/codex/shell-parser.js";

describe("Codex shell-parser extractFiles()", () => {
  it("extracts files from redirect operators", () => {
    const { paths, approximate } = extractFiles(["echo hello > output.txt"]);
    expect(paths).toContain("output.txt");
    expect(approximate).toBe(true);
  });

  it("extracts files from append redirects", () => {
    const { paths } = extractFiles(["echo line >> log.txt"]);
    expect(paths).toContain("log.txt");
  });

  it("extracts files from vim command", () => {
    const { paths } = extractFiles(["vim src/main.ts"]);
    expect(paths).toContain("src/main.ts");
  });

  it("extracts files from touch command", () => {
    const { paths } = extractFiles(["touch newfile.txt"]);
    expect(paths).toContain("newfile.txt");
  });

  it("extracts files from cp command", () => {
    const { paths } = extractFiles(["cp src/foo.ts src/bar.ts"]);
    expect(paths).toContain("src/foo.ts");
    expect(paths).toContain("src/bar.ts");
  });

  it("extracts files from git add", () => {
    const { paths } = extractFiles(["git add src/auth.ts"]);
    expect(paths).toContain("src/auth.ts");
  });

  it("extracts files from git checkout", () => {
    const { paths } = extractFiles(["git checkout -- src/config.ts"]);
    expect(paths).toContain("src/config.ts");
  });

  it("filters out denylist commands (ls)", () => {
    const { paths } = extractFiles(["ls -la"]);
    expect(paths).toHaveLength(0);
  });

  it("filters out denylist commands (pwd)", () => {
    const { paths } = extractFiles(["pwd"]);
    expect(paths).toHaveLength(0);
  });

  it("filters out denylist commands (cd)", () => {
    const { paths } = extractFiles(["cd /home/user"]);
    expect(paths).toHaveLength(0);
  });

  it("filters out denylist commands (which)", () => {
    const { paths } = extractFiles(["which node"]);
    expect(paths).toHaveLength(0);
  });

  it("deduplicates repeated paths", () => {
    const { paths } = extractFiles([
      "vim src/auth.ts",
      "vim src/auth.ts",
      "vim src/auth.ts",
    ]);
    expect(paths.filter((p) => p === "src/auth.ts")).toHaveLength(1);
  });

  it("caps output at 50 paths", () => {
    const commands: string[] = [];
    for (let i = 0; i < 100; i++) {
      commands.push(`touch file-${i}.ts`);
    }
    const { paths } = extractFiles(commands);
    expect(paths.length).toBeLessThanOrEqual(50);
  });

  it("always returns approximate: true", () => {
    const { approximate } = extractFiles([]);
    expect(approximate).toBe(true);

    const { approximate: a2 } = extractFiles(["vim src/foo.ts"]);
    expect(a2).toBe(true);
  });

  it("returns empty paths for empty input", () => {
    const { paths } = extractFiles([]);
    expect(paths).toHaveLength(0);
  });

  it("handles mixed commands — only extracts relevant ones", () => {
    const commands = [
      "ls -la",
      "cd /project",
      "vim src/index.ts",
      "pwd",
      "git add src/types.ts",
    ];
    const { paths } = extractFiles(commands);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/types.ts");
    expect(paths).not.toContain("-la");
  });
});
