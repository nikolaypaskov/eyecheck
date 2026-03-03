import { z } from "zod";
import {
  extractCssCustomProperties,
  extractTailwindTokens,
  mergeTokenMaps,
  type TokenMap,
} from "../tokens.js";
import type { ServerState } from "../index.js";

export const SetTokensInputSchema = z.object({
  tailwindConfig: z.string().optional().describe("Path to tailwind.config.js"),
  cssFile: z.string().optional().describe("Path to CSS file with custom properties"),
});

export type SetTokensInput = z.infer<typeof SetTokensInputSchema>;

export async function handleSetTokens(
  input: SetTokensInput,
  state: ServerState,
): Promise<string> {
  const maps: TokenMap[] = [];
  const sources: string[] = [];

  if (input.tailwindConfig) {
    try {
      const tokens = await extractTailwindTokens(input.tailwindConfig);
      maps.push(tokens);
      sources.push(`Tailwind: ${input.tailwindConfig}`);
    } catch (err) {
      return `Failed to extract Tailwind tokens: ${err}`;
    }
  }

  if (input.cssFile) {
    try {
      const tokens = await extractCssCustomProperties(input.cssFile);
      maps.push(tokens);
      sources.push(`CSS: ${input.cssFile}`);
    } catch (err) {
      return `Failed to extract CSS tokens: ${err}`;
    }
  }

  if (maps.length === 0) {
    return "No token sources provided. Specify tailwindConfig or cssFile.";
  }

  const merged = mergeTokenMaps(...maps);
  state.tokens = merged;

  const colorCount = Object.keys(merged.colors).length;
  const spacingCount = Object.keys(merged.spacing).length;
  const fontCount = Object.keys(merged.fontSize).length;

  return [
    `Design tokens loaded successfully.`,
    `  Sources: ${sources.join(", ")}`,
    `  Colors: ${colorCount} tokens`,
    `  Spacing: ${spacingCount} tokens`,
    `  Font sizes: ${fontCount} tokens`,
  ].join("\n");
}
