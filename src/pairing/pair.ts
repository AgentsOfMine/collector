import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".agentsofmine");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const PAIR_BASE_URL = "https://agentsofmine.io";
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface PairingConfig {
  deviceId: string;
  deviceToken: string;
  pairedAt: string;
}

export function readPairingConfig(): PairingConfig | null {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "deviceId" in parsed &&
      "deviceToken" in parsed &&
      "pairedAt" in parsed &&
      typeof (parsed as Record<string, unknown>)["deviceId"] === "string" &&
      typeof (parsed as Record<string, unknown>)["deviceToken"] === "string" &&
      typeof (parsed as Record<string, unknown>)["pairedAt"] === "string"
    ) {
      return parsed as PairingConfig;
    }
  } catch {
    // missing or malformed — treat as unpaired
  }
  return null;
}

function writePairingConfig(config: PairingConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

function clearPairingConfig(): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, "{}", "utf8");
  } catch {
    // ignore
  }
}

function getVersion(): string {
  try {
    const pkgPath = new URL("../../package.json", import.meta.url);
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

interface PairInitResponse {
  pairingCode: string;
  expiresInSeconds: number;
}

interface PairStatusResponse {
  status: "pending" | "approved" | "expired";
  deviceToken?: string;
}

async function httpPost<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function httpGet<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function renderPairingBox(code: string, secondsLeft: number): void {
  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timer = `${minutes}:${String(secs).padStart(2, "0")}`;
  const line = `  Pairing code: ${code}     `;
  const timerLine = `  Expires in:   ${timer}          `;

  process.stdout.write("\r\x1b[K");
  process.stdout.write(
    [
      "╔══════════════════════════════╗",
      `║${line.padEnd(30)}║`,
      `║${timerLine.padEnd(30)}║`,
      "╚══════════════════════════════╝",
    ].join("\n") + "\n"
  );
  process.stdout.write("Open https://agentsofmine.io on your phone and enter this code.\n");
  process.stdout.write("Waiting for approval…");
}

export async function runPairFlow(reset: boolean): Promise<void> {
  const existing = readPairingConfig();

  if (existing?.deviceToken && !reset) {
    console.log(
      `Already paired (deviceId: ${existing.deviceId}). Run \`aom pair --reset\` to re-pair.`
    );
    process.exit(0);
  }

  if (reset) {
    clearPairingConfig();
  }

  const version = getVersion();
  const deviceId = crypto.randomUUID();
  const userAgent = `aom-collector/${version} (${process.platform})`;

  let initResponse: PairInitResponse;
  try {
    initResponse = await httpPost<PairInitResponse>(`${PAIR_BASE_URL}/pair/init`, {
      deviceId,
      userAgent,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to initiate pairing: ${msg}`);
    process.exit(1);
  }

  const { pairingCode, expiresInSeconds } = initResponse;
  let secondsLeft = expiresInSeconds;

  // Clear screen area and render box
  renderPairingBox(pairingCode, secondsLeft);

  // Countdown timer — redraws the last line with updated time
  const countdownTimer = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft < 0) secondsLeft = 0;
    // Move up 6 lines and redraw box
    process.stdout.write("\x1b[6A");
    renderPairingBox(pairingCode, secondsLeft);
  }, 1000);

  // Ctrl-C handler
  process.on("SIGINT", () => {
    clearInterval(countdownTimer);
    process.stdout.write("\n");
    console.log("Pairing cancelled.");
    process.exit(1);
  });

  const deadline = Date.now() + TIMEOUT_MS;

  // Poll loop
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    let statusResponse: PairStatusResponse;
    try {
      statusResponse = await httpGet<PairStatusResponse>(
        `${PAIR_BASE_URL}/pair/status?device=${encodeURIComponent(deviceId)}`
      );
    } catch {
      // transient network error — keep polling
      continue;
    }

    if (statusResponse.status === "approved" && statusResponse.deviceToken) {
      clearInterval(countdownTimer);
      process.stdout.write("\n\n");

      writePairingConfig({
        deviceId,
        deviceToken: statusResponse.deviceToken,
        pairedAt: new Date().toISOString(),
      });

      console.log("✓ Paired successfully. Collector is ready to sync.");
      process.exit(0);
    }

    if (statusResponse.status === "expired") {
      clearInterval(countdownTimer);
      process.stdout.write("\n\n");
      console.error("Pairing code expired. Run `aom pair` again.");
      process.exit(1);
    }
  }

  clearInterval(countdownTimer);
  process.stdout.write("\n\n");
  console.error("Pairing timed out. Run `aom pair` again.");
  process.exit(1);
}
