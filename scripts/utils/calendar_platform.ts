export function isMacOS(): boolean {
  return process.platform === "darwin";
}

export function assertMacOSCalendar(): void {
  if (!isMacOS()) {
    throw new Error(
      "Calendar sync only works on macOS. Diet, sleep, and exercise logging to Feishu still works on this computer."
    );
  }
}
