import { z } from "zod";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { screenshotUrl, screenshotMultipleViewports } from "../renderers/playwright.js";
import { compare, analyze, type DiffRegion } from "../core-bridge.js";
import { config, ViewportSchema } from "../config.js";
import type { ServerState, CheckResult } from "../index.js";
import { mapValueToToken } from "../tokens.js";

export const CheckInputSchema = z.object({
  url: z.string().describe("URL to render and compare against reference"),
  selector: z.string().optional().describe("CSS selector to screenshot a specific element"),
  viewport: ViewportSchema.optional(),
  viewports: z
    .array(
      z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        label: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "Multiple viewports for responsive testing. When provided, tests all viewports and returns aggregated results.",
    ),
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

  // Multi-viewport mode
  if (input.viewports && input.viewports.length > 0) {
    const screenshots = await screenshotMultipleViewports(
      input.url,
      outDir,
      input.viewports,
      { selector: input.selector },
    );

    const vpResults: Array<{
      label: string;
      passed: boolean;
      ssim: number;
      diffPct: number;
      issues?: string[];
    }> = [];

    for (const ss of screenshots) {
      const label = ss.viewport.label ?? `${ss.viewport.width}x${ss.viewport.height}`;
      const vpDiffPath = path.join(outDir, `diff-${label}-${timestamp}.png`);

      const cmp = await compare(
        state.reference.path,
        ss.outputPath,
        config.ssimThreshold,
        vpDiffPath,
      );

      const entry: (typeof vpResults)[number] = {
        label,
        passed: cmp.passed,
        ssim: cmp.ssim_score,
        diffPct: cmp.diff_percentage,
      };

      if (!cmp.passed) {
        const analysis = await analyze(state.reference.path, ss.outputPath);
        entry.issues = analysis.issues.map(
          (issue, i) =>
            `  ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.issue_type} — ${issue.element}: ${issue.actual}, should be ${issue.expected}`,
        );
      }

      vpResults.push(entry);
    }

    const failCount = vpResults.filter((r) => !r.passed).length;
    const allPassed = failCount === 0;

    const lines = [`=== Responsive Check: ${input.url} ===`, ""];
    for (const r of vpResults) {
      const status = r.passed ? "PASS" : "FAIL";
      lines.push(
        `[${r.label}] ${status} — SSIM: ${r.ssim.toFixed(4)} | Diff: ${r.diffPct.toFixed(2)}%`,
      );
      if (r.issues) {
        lines.push(...r.issues);
      }
    }
    lines.push("");
    lines.push(
      `Overall: ${allPassed ? "PASS" : "FAIL"} (${failCount} of ${vpResults.length} viewports failed)`,
    );

    const report = lines.join("\n");
    const worstSsim = Math.min(...vpResults.map((r) => r.ssim));
    const worstDiffPct = Math.max(...vpResults.map((r) => r.diffPct));

    state.latestCheck = {
      passed: allPassed,
      ssim: worstSsim,
      diffPercentage: worstDiffPct,
      url: input.url,
      checkedAt: new Date().toISOString(),
      report,
    };
    state.scoreHistory.push({
      ssim: worstSsim,
      timestamp: state.latestCheck.checkedAt,
      url: input.url,
    });

    return report;
  }

  // Single-viewport mode
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

  const regionLines = formatRegions(compareResult.regions);

  if (compareResult.passed) {
    report = [
      `PASS - Visual check passed`,
      `  SSIM: ${compareResult.ssim_score.toFixed(4)}`,
      `  Threshold: ${config.ssimThreshold}`,
      `  Pixel differences: ${compareResult.diff_pixels} (${compareResult.diff_percentage.toFixed(2)}%)`,
      ...regionLines,
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
      ...regionLines,
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

function formatRegions(regions: DiffRegion[]): string[] {
  if (!regions || regions.length === 0) return [];
  const lines = [`  Regions: ${regions.length} changed areas`];
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    lines.push(
      `    Region ${i + 1}: (${r.x}, ${r.y}) ${r.width}x${r.height} -- ${r.pixel_count} pixels`,
    );
  }
  return lines;
}
