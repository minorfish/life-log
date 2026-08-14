import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { isMacOS } from "./calendar_platform.js";

// Builds scripts/bin/sleep_sync.app from scripts/utils/sleep_sync.swift on demand.
//
// The compiled .app is a machine-specific build artifact (gitignored, not
// committed) — it must be rebuilt on every machine that wants EventKit-based
// Calendar sync. This file is the single source of truth for that build so
// setup and the sync path never drift out of sync with each other.

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SWIFT_SOURCE = join(__dirname, "sleep_sync.swift");
export const APP_DIR = join(__dirname, "..", "bin", "sleep_sync.app");
const CONTENTS_DIR = join(APP_DIR, "Contents");
const MACOS_DIR = join(CONTENTS_DIR, "MacOS");
export const BINARY_PATH = join(MACOS_DIR, "sleep_sync");
const INFO_PLIST_PATH = join(CONTENTS_DIR, "Info.plist");

// Bundle identifier + usage strings macOS shows in the Calendar permission
// prompt and in System Settings → Privacy & Security → Calendar. Keeping
// these in one tracked place avoids the .app (gitignored) being the only
// copy of this text.
const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>sleep_sync</string>
    <key>CFBundleIdentifier</key>
    <string>cn.workbuddy.life-log.sleep-sync</string>
    <key>CFBundleName</key>
    <string>SleepSync</string>
    <key>CFBundleDisplayName</key>
    <string>SleepSync</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSCalendarsUsageDescription</key>
    <string>记录睡眠数据到日历</string>
    <key>NSCalendarsFullAccessUsageDescription</key>
    <string>记录睡眠数据到睡眠日历，用于自动同步每晚的睡眠记录。</string>
</dict>
</plist>
`;

export type BuildResult = { ok: boolean; error?: string };

export function isSleepSyncAppBuilt(): boolean {
  return existsSync(BINARY_PATH);
}

export function isSwiftToolchainAvailable(): boolean {
  try {
    execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function buildSleepSyncApp(): BuildResult {
  if (!isMacOS()) {
    return { ok: false, error: "The Calendar helper app is macOS-only." };
  }
  if (!existsSync(SWIFT_SOURCE)) {
    return { ok: false, error: `Missing source file: ${SWIFT_SOURCE}` };
  }
  if (!isSwiftToolchainAvailable()) {
    return {
      ok: false,
      error:
        "swiftc not found. Install Xcode Command Line Tools first (run `xcode-select --install`), then retry.",
    };
  }

  try {
    mkdirSync(MACOS_DIR, { recursive: true });
    writeFileSync(INFO_PLIST_PATH, INFO_PLIST, "utf-8");

    execFileSync("xcrun", ["swiftc", "-O", SWIFT_SOURCE, "-o", BINARY_PATH], {
      stdio: "pipe",
    });
    chmodSync(BINARY_PATH, 0o755);

    // Re-sign the *whole bundle* (not just the executable) so Info.plist is
    // sealed into the code signature. This is best-effort: without it the
    // EventKit permission prompt still works, but the Calendar permission
    // grant may be less stable across future rebuilds of the binary.
    try {
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", APP_DIR], {
        stdio: "pipe",
      });
    } catch {
      // Non-fatal — continue even if ad-hoc re-signing fails.
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function ensureSleepSyncAppBuilt(): BuildResult & { built: boolean } {
  if (isSleepSyncAppBuilt()) {
    return { ok: true, built: false };
  }
  const result = buildSleepSyncApp();
  return { ...result, built: result.ok };
}

async function main() {
  const result = buildSleepSyncApp();
  if (result.ok) {
    console.log(`✅ Built Calendar helper app at ${APP_DIR}`);
  } else {
    console.error(`⚠️ Could not build the Calendar helper app: ${result.error}`);
    console.error("Sleep logging still works — this only affects automatic macOS Calendar sync.");
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith("build_sleep_sync.ts");
if (isMain) {
  main();
}
