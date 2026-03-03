import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readdir, copyFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface PaparazziOptions {
  module: string;
  composableFilter?: string;
}

async function checkPrerequisites(projectDir: string): Promise<void> {
  const gradlew = path.join(projectDir, "gradlew");
  try {
    await access(gradlew);
  } catch {
    throw new Error(`gradlew not found in ${projectDir}. Ensure this is an Android project root.`);
  }
}

export async function recordSnapshots(
  projectDir: string,
  module: string,
  composableFilter: string | undefined,
  outputDir: string,
): Promise<string[]> {
  await checkPrerequisites(projectDir);

  const gradlew = path.join(projectDir, "gradlew");
  const task = `:${module}:recordPaparazziDebug`;

  const args = [task];
  if (composableFilter) {
    args.push(`-Pandroid.testInstrumentationRunnerArguments.class=${composableFilter}`);
  }

  await execFileAsync(gradlew, args, {
    cwd: projectDir,
    timeout: 300_000, // 5 minutes for Gradle
    env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME ?? "" },
  });

  // Collect snapshot PNGs from Paparazzi output directory
  const snapshotsDir = path.join(projectDir, module, "src", "test", "snapshots", "images");
  const files = await readdir(snapshotsDir);
  const pngs = files.filter(f => f.endsWith(".png"));

  const outputPaths: string[] = [];
  for (const png of pngs) {
    const dest = path.join(outputDir, png);
    await copyFile(path.join(snapshotsDir, png), dest);
    outputPaths.push(dest);
  }

  return outputPaths;
}
