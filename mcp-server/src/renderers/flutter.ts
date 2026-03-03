import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface FlutterOptions {
  testFilter?: string;
  goldenDir?: string;
}

async function checkPrerequisites(): Promise<void> {
  try {
    await execFileAsync("which", ["flutter"]);
  } catch {
    throw new Error("flutter not found on PATH. Install Flutter SDK.");
  }
}

export async function updateGoldens(
  projectDir: string,
  testFilter: string | undefined,
  goldenPath: string | undefined,
): Promise<string[]> {
  await checkPrerequisites();

  const args = ["test", "--update-goldens"];
  if (testFilter) {
    args.push(testFilter);
  }

  await execFileAsync("flutter", args, {
    cwd: projectDir,
    timeout: 180_000, // 3 minutes
  });

  // Collect golden PNGs
  const goldenDir = goldenPath ?? path.join(projectDir, "test", "goldens");

  try {
    const files = await readdir(goldenDir);
    return files
      .filter(f => f.endsWith(".png"))
      .map(f => path.join(goldenDir, f));
  } catch {
    throw new Error(`Golden directory not found at ${goldenDir}`);
  }
}
