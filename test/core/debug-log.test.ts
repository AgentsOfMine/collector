import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debugLog } from "../../src/core/debug-log.js";

describe("debugLog", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  const savedDebug = process.env["AOM_DEBUG"];

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    if (savedDebug === undefined) delete process.env["AOM_DEBUG"];
    else process.env["AOM_DEBUG"] = savedDebug;
  });

  it("is silent when AOM_DEBUG is unset", () => {
    delete process.env["AOM_DEBUG"];
    debugLog("ctx", new Error("boom"));
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("writes to stderr (never stdout) when AOM_DEBUG is set", () => {
    process.env["AOM_DEBUG"] = "1";
    debugLog("opencode: db busy", new Error("SQLITE_BUSY"));
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith("[aom] opencode: db busy: SQLITE_BUSY");
  });

  it("stringifies non-Error values", () => {
    process.env["AOM_DEBUG"] = "1";
    debugLog("ctx", "plain string");
    expect(stderrSpy).toHaveBeenCalledWith("[aom] ctx: plain string");
  });
});
