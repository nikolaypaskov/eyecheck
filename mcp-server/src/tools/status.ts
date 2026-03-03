import type { ServerState } from "../index.js";

export async function handleStatus(state: ServerState): Promise<string> {
  const lines: string[] = ["=== eyecheck status ===", ""];

  // Reference info
  if (state.reference) {
    lines.push("Reference:");
    lines.push(`  Type: ${state.reference.type}`);
    lines.push(`  Source: ${state.reference.source}`);
    lines.push(`  Dimensions: ${state.reference.dimensions.width}x${state.reference.dimensions.height}`);
    lines.push(`  Set at: ${state.reference.setAt}`);
  } else {
    lines.push("Reference: Not set");
  }
  lines.push("");

  // Latest check
  if (state.latestCheck) {
    lines.push("Latest check:");
    lines.push(`  Result: ${state.latestCheck.passed ? "PASS" : "FAIL"}`);
    lines.push(`  SSIM: ${state.latestCheck.ssim.toFixed(4)}`);
    lines.push(`  Diff: ${state.latestCheck.diffPercentage.toFixed(2)}%`);
    lines.push(`  URL: ${state.latestCheck.url}`);
    lines.push(`  Checked at: ${state.latestCheck.checkedAt}`);
  } else {
    lines.push("Latest check: None");
  }
  lines.push("");

  // Watch mode
  if (state.watchMode) {
    lines.push("Watch mode: Active");
    lines.push(`  Watching: ${state.watchMode.glob}`);
    lines.push(`  URL: ${state.watchMode.url}`);
    lines.push(`  Started: ${state.watchMode.startedAt}`);
  } else {
    lines.push("Watch mode: Inactive");
  }
  lines.push("");

  // Score history
  if (state.scoreHistory.length > 0) {
    lines.push(`Score history (last ${Math.min(state.scoreHistory.length, 10)}):`);
    const recent = state.scoreHistory.slice(-10);
    for (const entry of recent) {
      lines.push(
        `  ${entry.timestamp} | SSIM: ${entry.ssim.toFixed(4)} | ${entry.url}`,
      );
    }
  } else {
    lines.push("Score history: Empty");
  }

  return lines.join("\n");
}
