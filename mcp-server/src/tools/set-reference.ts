import { z } from "zod";
import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { screenshotUrl } from "../renderers/playwright.js";
import type { ServerState } from "../index.js";
import { ViewportSchema } from "../config.js";

export const SetReferenceInputSchema = z.object({
  type: z.enum(["url", "file", "screenshot"]),
  value: z.string().describe("URL, file path, or localhost URL to screenshot"),
  viewport: ViewportSchema.optional(),
});

export type SetReferenceInput = z.infer<typeof SetReferenceInputSchema>;

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
      // We don't know dimensions from a raw file copy without reading the image,
      // but for simplicity report 0x0 and let compare determine actual dims.
      width = 0;
      height = 0;
      break;
    }
  }

  state.reference = {
    type: input.type,
    source: input.value,
    path: refPath,
    dimensions: { width, height },
    setAt: new Date().toISOString(),
  };

  return [
    `Reference set successfully.`,
    `  Type: ${input.type}`,
    `  Source: ${input.value}`,
    `  Saved to: ${refPath}`,
    `  Dimensions: ${width}x${height}`,
  ].join("\n");
}
