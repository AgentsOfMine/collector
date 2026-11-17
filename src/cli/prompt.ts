import type { Readable, Writable } from "node:stream";

/**
 * Ask a yes/no question on the terminal. Anything but `y` / `yes` is a no, and
 * so is end-of-input (`aom unpair < /dev/null`), which would otherwise leave the
 * question unanswered forever.
 *
 * The input is paused once answered. Leaving a TTY stdin flowing keeps the Node
 * process alive, which made `aom unpair` hang after confirming.
 */
export function askYesNo(
  question: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: boolean): void => {
      if (settled) return;
      settled = true;
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.pause();
      resolve(answer);
    };
    const onData = (chunk: string | Buffer): void => {
      const answer = chunk.toString().trim().toLowerCase();
      finish(answer === "y" || answer === "yes");
    };
    const onEnd = (): void => finish(false);

    output.write(question);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.on("end", onEnd);
    input.resume();
  });
}
