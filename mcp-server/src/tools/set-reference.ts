import { z } from "zod";
import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { screenshotUrl } from "../renderers/playwright.js";
import type { ServerState } from "../index.js";
import { ViewportSchema } from "../config.js";
import { saveBaseline } from "../storage.js";

export const SetReferenceInputSchema = z.object({
  type: z.enum(["url", "file", "screenshot"]),
  value: z.string().describe("URL, file path, or localhost URL to screenshot"),
  viewport: ViewportSchema.optional(),
  name: z.string().optional().describe("Name for this baseline (default: auto-generated from URL hostname)"),
});

export type SetReferenceInput = z.infer<typeof SetReferenceInputSchema>;

function generateName(type: string, value: string): string {
  if (type === "file") {
    return path.basename(value, path.extname(value));
  }
  try {
    const url = new URL(value);
    return url.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  } catch {
    return `baseline-${Date.now()}`;
  }
}

export async function handleSetReference(
  input: SetReferenceInput,
  state: ServerState,
): Promise<string> {
  const refDir = path.join(tmpdir(), "eyecheck", "references");
  await mkdir(refDir, { recursive: true });
  const refPath = path.join(refDir, `reference-${Date.now()}.png`);

  let width: number;
  let height: number;

  switch (input.type) {
    case "url": {
      const dims = await screenshotUrl(input.value, refPath, {
        viewport: input.viewport,
      });
      width = dims.width;
      height = dims.height;
      break;
    }
    case "screenshot": {
      const dims = await screenshotUrl(input.value, refPath, {
        viewport: input.viewport,
      });
      width = dims.width;
      height = dims.height;
      break;
    }
    case "file": {
      await copyFile(input.value, refPath);
      width = 0;
      height = 0;
      break;
    }
  }

  const name = input.name ?? generateName(input.type, input.value);
  const viewport = { width: input.viewport?.width ?? 1280, height: input.viewport?.height ?? 720 };

  // Persist baseline to SQLite + filesystem
  const baseline = saveBaseline(name, input.value, null, viewport, refPath);

  state.reference = {
    type: input.type,
    source: input.value,
    path: baseline.image_path,
    dimensions: { width, height },
    setAt: new Date().toISOString(),
  };

  return [
    `Reference set successfully.`,
    `  Name: ${name}`,
    `  Type: ${input.type}`,
    `  Source: ${input.value}`,
    `  Saved to: ${baseline.image_path}`,
    `  Dimensions: ${width}x${height}`,
  ].join("\n");
}
