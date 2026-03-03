import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, copyFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface XcodeRenderOptions {
  scheme: string;
  destination: string; // e.g., "platform=iOS Simulator,name=iPhone 16"
  previewFilter?: string;
}

async function checkPrerequisites(): Promise<void> {
  try {
    await execFileAsync("which", ["xcodebuild"]);
  } catch {
    throw new Error("xcodebuild not found. Install Xcode and Xcode Command Line Tools.");
  }
}

export async function renderPreview(
  scheme: string,
  destination: string,
  previewName: string,
  outputPath: string,
): Promise<string> {
  await checkPrerequisites();

  // Run xcodebuild test to generate previews
  const xcresultPath = `/tmp/eyecheck/xcode/${Date.now()}.xcresult`;

  try {
    await execFileAsync("xcodebuild", [
      "test",
      "-scheme", scheme,
      "-destination", destination,
      "-resultBundlePath", xcresultPath,
      "-only-testing", previewName,
    ], { timeout: 120_000 });
  } catch (err: any) {
    // xcodebuild may exit non-zero but still produce results
    if (!err.stdout && !err.stderr) throw err;
  }

  // Try to extract screenshot from xcresult bundle
  try {
    const { stdout } = await execFileAsync("xcrun", [
      "xcresulttool", "get",
      "--path", xcresultPath,
      "--format", "json",
    ]);

    // Parse xcresult and find attachment references
    const result = JSON.parse(stdout);
    // Extract the screenshot attachment
    const attachmentId = findScreenshotAttachment(result);

    if (attachmentId) {
      await execFileAsync("xcrun", [
        "xcresulttool", "export",
        "--type", "file",
        "--path", xcresultPath,
        "--id", attachmentId,
        "--output-path", outputPath,
      ]);
      return outputPath;
    }
  } catch {
    // Fall through to snapshot directory fallback
  }

  // Fallback: look for swift-snapshot-testing __Snapshots__/ directory
  const snapshotsDir = path.join(path.dirname(scheme), "__Snapshots__");
  try {
    const files = await readdir(snapshotsDir);
    const match = files.find(f => f.includes(previewName) && f.endsWith(".png"));
    if (match) {
      await copyFile(path.join(snapshotsDir, match), outputPath);
      return outputPath;
    }
  } catch {
    // No snapshots directory
  }

  throw new Error(`Could not extract preview screenshot for "${previewName}"`);
}

function findScreenshotAttachment(xcresult: any): string | null {
  // Navigate xcresult JSON structure to find screenshot attachments
  try {
    const actions = xcresult?.actions?._values ?? [];
    for (const action of actions) {
      const testRef = action?.actionResult?.testsRef;
      if (testRef?.id?._value) {
        return testRef.id._value;
      }
    }
  } catch {
    // Structure mismatch
  }
  return null;
}
