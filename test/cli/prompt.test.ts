import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { askYesNo } from "../../src/cli/prompt.js";

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (c: Buffer) => (printed += c.toString()));
  return { input, output, printed: () => printed };
}

describe("askYesNo", () => {
  it.each(["y", "Y", "yes", "YES", "  yes  "])("accepts %j as yes", async (answer) => {
    const { input, output } = streams();
    const result = askYesNo("Sure? ", input, output);
    input.write(`${answer}\n`);
    expect(await result).toBe(true);
  });

  it.each(["n", "no", "", "maybe", "yep"])("treats %j as no", async (answer) => {
    const { input, output } = streams();
    const result = askYesNo("Sure? ", input, output);
    input.write(`${answer}\n`);
    expect(await result).toBe(false);
  });

  it("prints the question", async () => {
    const { input, output, printed } = streams();
    const result = askYesNo("Remove it? [y/N] ", input, output);
    input.write("y\n");
    await result;
    expect(printed()).toBe("Remove it? [y/N] ");
  });

  it("answers no when input ends without an answer (aom unpair < /dev/null)", async () => {
    const { input, output } = streams();
    const result = askYesNo("Sure? ", input, output);
    input.end();
    expect(await result).toBe(false);
  });

  it("pauses the input once answered so a TTY stdin cannot keep the process alive", async () => {
    const { input, output } = streams();
    const result = askYesNo("Sure? ", input, output);
    input.write("y\n");
    await result;
    expect(input.isPaused()).toBe(true);
  });

  it("stops listening after the first answer", async () => {
    const { input, output } = streams();
    const result = askYesNo("Sure? ", input, output);
    input.write("y\n");
    await result;
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
  });
});
