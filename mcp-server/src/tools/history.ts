import { z } from "zod";
import { getBaseline, getHistory } from "../storage.js";

export const HistoryInputSchema = z.object({
  name: z.string().describe("Baseline name to view history for"),
  limit: z.number().int().positive().optional().default(20).describe("Number of recent comparisons to show"),
});

export type HistoryInput = z.infer<typeof HistoryInputSchema>;

export async function handleHistory(input: HistoryInput): Promise<string> {
  const baseline = getBaseline(input.name);
  if (!baseline) {
    return `Baseline "${input.name}" not found.`;
  }

  const history = getHistory(baseline.id, input.limit);
  if (history.length === 0) {
    return `No comparison history found for baseline "${input.name}".`;
  }

  const lines: string[] = [
    `=== History for "${input.name}" (${baseline.viewport_width}x${baseline.viewport_height}) ===`,
    "",
  ];

  for (const comp of history) {
    const status = comp.passed ? "PASS" : "FAIL";
    lines.push(
      `  ${comp.created_at} | ${status} | SSIM: ${comp.ssim_score?.toFixed(4) ?? "N/A"} | Diff: ${comp.diff_percentage?.toFixed(2) ?? "N/A"}%`,
    );
  }

  lines.push("");
  lines.push(`Total comparisons: ${history.length}`);

  return lines.join("\n");
}
