import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CompareResult {
  ssim_score: number;
  passed: boolean;
  diff_pixels: number;
  total_pixels: number;
  diff_percentage: number;
  diff_image_path?: string;
}

export interface AnalyzeResult {
  match_score: number;
  issues: VisualIssue[];
  summary: string;
}

export interface VisualIssue {
  issue_type: string;
  element: string;
  actual: string;
  expected: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
}

let binaryPath: string | null = null;

async function findBinary(): Promise<string> {
  if (binaryPath) return binaryPath;

  const candidates = [
    path.resolve(import.meta.dirname, "../../core/target/release/eyecheck-core"),
    path.resolve(import.meta.dirname, "../../core/target/debug/eyecheck-core"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      binaryPath = candidate;
      return candidate;
    } catch {
      // try next
    }
  }

  // Fall back to PATH
  binaryPath = "eyecheck-core";
  return binaryPath;
}

export async function compare(
  referencePath: string,
  currentPath: string,
  threshold?: number,
  diffOutputPath?: string,
): Promise<CompareResult> {
  const bin = await findBinary();
  const args = ["compare", "--baseline", referencePath, "--test", currentPath];
  if (threshold !== undefined) {
    args.push("--threshold", threshold.toString());
  }
  if (diffOutputPath) {
    args.push("--output", diffOutputPath);
  }
  args.push("--json");

  const { stdout } = await execFileAsync(bin, args, { timeout: 30_000 });
  try {
    return JSON.parse(stdout) as CompareResult;
  } catch (e) {
    throw new Error(`Failed to parse compare output: ${e}\nOutput: ${stdout}`);
  }
}

export async function analyze(
  referencePath: string,
  currentPath: string,
): Promise<AnalyzeResult> {
  const bin = await findBinary();
  const args = ["analyze", "--reference", referencePath, "--render", currentPath, "--json"];

  const { stdout } = await execFileAsync(bin, args, { timeout: 60_000 });
  try {
    return JSON.parse(stdout) as AnalyzeResult;
  } catch (e) {
    throw new Error(`Failed to parse analyze output: ${e}\nOutput: ${stdout}`);
  }
}
