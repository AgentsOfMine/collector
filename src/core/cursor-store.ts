import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CursorStore {
  get(adapterName: string): string | null;
  set(adapterName: string, value: string): void;
  flush(): void;
}

export class FileCursorStore implements CursorStore {
  private cache: Record<string, string> | null = null;
  private readonly cursorsFile: string;

  constructor(baseDir: string = join(homedir(), ".agentsofmine")) {
    this.cursorsFile = join(baseDir, "cursors.json");
  }

  get(adapterName: string): string | null {
    return this.getCache()[adapterName] ?? null;
  }

  set(adapterName: string, value: string): void {
    const data = this.getCache();
    data[adapterName] = value;
    this.saveToDisk(data);
  }

  flush(): void {
    if (this.cache !== null) {
      this.saveToDisk(this.cache);
    }
  }

  private getCache(): Record<string, string> {
    if (this.cache === null) {
      this.cache = this.loadFromDisk();
    }
    return this.cache;
  }

  private loadFromDisk(): Record<string, string> {
    try {
      const raw = readFileSync(this.cursorsFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // file missing or unparseable — start fresh
    }
    return {};
  }

  private saveToDisk(data: Record<string, string>): void {
    mkdirSync(join(this.cursorsFile, ".."), { recursive: true });
    const tmp = this.cursorsFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmp, this.cursorsFile);
  }
}

export const cursorStore: CursorStore = new FileCursorStore();
