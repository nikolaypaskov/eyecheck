import { z } from "zod";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { screenshotUrl } from "../renderers/playwright.js";
import { compare, analyze } from "../core-bridge.js";
import { config, ViewportSchema } from "../config.js";
import type { ServerState, CheckResult } from "../index.js";
import { mapValueToToken } from "../tokens.js";

export const CheckInputSchema = z.object({
  url: z.string().describe("URL to render and compare against reference"),
  selector: z.string().optional().describe("CSS selector to screenshot a specific element"),
  viewport: ViewportSchema.optional(),
});

export type CheckInput = z.infer<typeof CheckInputSchema>;

export async function handleCheck(
  input: CheckInput,
  state: ServerState,
): Promise<string> {
  if (!state.reference) {
    return "No reference set. Use set_reference first to establish a design reference.";
  }

  const outDir = path.join(tmpdir(), "eyecheck", "checks");
  await mkdir(outDir, { recursive: true });
  const timestamp = Date.now();
  const currentPath = path.join(outDir, `current-${timestamp}.png`);
  const diffPath = path.join(outDir, `diff-${timestamp}.png`);

  // Render the current page
  await screenshotUrl(input.url, currentPath, {
    viewport: input.viewport,
    selector: input.selector,
  });

  // Compare with reference
  const compareResult = await compare(
    state.reference.path,
    currentPath,
    config.ssimThreshold,
    diffPath,
  );

  let report: string;

  if (compareResult.passed) {
    report = [
      `PASS - Visual check passed`,
      `  SSIM: ${compareResult.ssim_score.toFixed(4)}`,
      `  Threshold: ${config.ssimThreshold}`,
      `  Pixel differences: ${compareResult.diff_pixels} (${compareResult.diff_percentage.toFixed(2)}%)`,
    ].join("\n");
  } else {
    // Run detailed analysis when below threshold
    const analysisResult = await analyze(state.reference.path, currentPath);

    const issueLines = analysisResult.issues.map((issue, i) => {
      let actual = issue.actual;
      let expected = issue.expected;

      // Map raw values to token names when tokens are available
      if (state.tokens) {
        const actualToken = mapValueToToken(actual, state.tokens);
        const expectedToken = mapValueToToken(expected, state.tokens);
        if (actualToken) actual = `${actual} (${actualToken})`;
        if (expectedToken) expected = `${expected} (${expectedToken})`;
      }

      return [
        `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.issue_type} — ${issue.element}: ${actual}, should be ${expected}`,
        `   → Fix: ${issue.suggestion}`,
      ].join("\n");
    });

    report = [
      `FAIL - Visual differences detected (score: ${compareResult.ssim_score.toFixed(2)})`,
      `  SSIM: ${compareResult.ssim_score.toFixed(4)}`,
      `  Threshold: ${config.ssimThreshold}`,
      `  Pixel differences: ${compareResult.diff_pixels} (${compareResult.diff_percentage.toFixed(2)}%)`,
      `  Diff image: ${diffPath}`,
      ``,
      `Issues found:`,
      ...issueLines,
      ``,
      `Summary: ${analysisResult.summary}`,
    ].join("\n");
  }

  const result: CheckResult = {
    passed: compareResult.passed,
    ssim: compareResult.ssim_score,
    diffPercentage: compareResult.diff_percentage,
    url: input.url,
    checkedAt: new Date().toISOString(),
    report,
  };

  state.latestCheck = result;
  state.scoreHistory.push({
    ssim: compareResult.ssim_score,
    timestamp: result.checkedAt,
    url: input.url,
  });

  return report;
}
