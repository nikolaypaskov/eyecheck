import { z } from "zod";
import { copyFileSync } from "node:fs";
import { saveBaseline, getBaseline, getLatestComparison, listBaselines } from "../storage.js";
import type { ServerState } from "../index.js";

export const ApproveInputSchema = z.object({
  name: z.string().optional().describe("Baseline name to approve (defaults to most recent)"),
});

export type ApproveInput = z.infer<typeof ApproveInputSchema>;

export async function handleApprove(
  input: ApproveInput,
  state: ServerState,
): Promise<string> {
  // Find the latest comparison
  const latestComparison = getLatestComparison();
  if (!latestComparison) {
    return "No comparison found to approve. Run a check first.";
  }

  // Determine which baseline to update
  let baselineName = input.name;
  if (!baselineName) {
    const baselines = listBaselines();
    if (baselines.length === 0) {
      return "No baselines found. Use set_reference first.";
    }
    baselineName = baselines[0].name;
  }

  const baseline = getBaseline(baselineName);
  if (!baseline) {
    return `Baseline "${baselineName}" not found.`;
  }

  const previousSsim = latestComparison.ssim_score;

  // Copy the test image over the baseline
  copyFileSync(latestComparison.test_image_path, baseline.image_path);

  // Update baseline in DB (re-save with same name to update hash/timestamp)
  const viewport = { width: baseline.viewport_width, height: baseline.viewport_height };
  saveBaseline(baselineName, baseline.url, baseline.selector, viewport, latestComparison.test_image_path);

  // Update in-memory reference to point to the new baseline
  if (state.reference) {
    state.reference.path = baseline.image_path;
    state.reference.setAt = new Date().toISOString();
  }

  return [
    `Baseline "${baselineName}" approved and updated.`,
    `  Previous SSIM: ${previousSsim?.toFixed(4) ?? "N/A"}`,
    `  Updated at: ${new Date().toISOString()}`,
    `  The current render is now the new baseline.`,
  ].join("\n");
}
