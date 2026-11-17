import { readFileSync } from "node:fs";

/**
 * The collector's version, read from package.json so there is one source of
 * truth. This file sits at the same depth in `src/core` and `dist/core`, so
 * `../../package.json` resolves to the package root in both.
 */
export function readVersion(packageJsonUrl: URL = new URL("../../package.json", import.meta.url)): string {
  const parsed = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version === "") {
    throw new Error(`package.json at ${packageJsonUrl.pathname} has no version`);
  }
  return parsed.version;
}

export const COLLECTOR_VERSION: string = readVersion();
