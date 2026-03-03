#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SetReferenceInputSchema, handleSetReference } from "./tools/set-reference.js";
import { CheckInputSchema, handleCheck } from "./tools/check.js";
import { WatchInputSchema, handleWatch, stopWatch } from "./tools/watch.js";
import { handleStatus } from "./tools/status.js";
import { SetTokensInputSchema, handleSetTokens } from "./tools/set-tokens.js";
import type { TokenMap } from "./tokens.js";
import { closeBrowser } from "./renderers/playwright.js";

export interface ReferenceInfo {
  type: "url" | "file" | "screenshot";
  source: string;
  path: string;
  dimensions: { width: number; height: number };
  setAt: string;
}

export interface CheckResult {
  passed: boolean;
  ssim: number;
  diffPercentage: number;
  url: string;
  checkedAt: string;
  report: string;
}

export interface WatchModeState {
  active: boolean;
  glob: string;
  url: string;
  startedAt: string;
}

export interface ScoreEntry {
  ssim: number;
  timestamp: string;
  url: string;
}

export interface ServerState {
  reference: ReferenceInfo | null;
  latestCheck: CheckResult | null;
  watchMode: WatchModeState | null;
  scoreHistory: ScoreEntry[];
  tokens: TokenMap | null;
}

const state: ServerState = {
  reference: null,
  latestCheck: null,
  watchMode: null,
  scoreHistory: [],
  tokens: null,
};

const server = new McpServer({
  name: "eyecheck",
  version: "0.1.0",
});

server.tool(
  "set_reference",
  "Store a design reference image for visual comparison. Accepts a URL to screenshot, a local file path, or a localhost URL.",
  SetReferenceInputSchema.shape,
  async ({ type, value, viewport }) => {
    const result = await handleSetReference({ type, value, viewport }, state);
    return { content: [{ type: "text" as const, text: result }] };
  },
);

server.tool(
  "check",
  "Render a URL and compare it against the stored reference image. Reports SSIM score, pixel differences, and detailed analysis of visual discrepancies.",
  CheckInputSchema.shape,
  async ({ url, selector, viewport }) => {
    const result = await handleCheck({ url, selector, viewport }, state);
    return { content: [{ type: "text" as const, text: result }] };
  },
);

server.tool(
  "watch",
  "Start watching files for changes and automatically re-run visual checks. Uses file glob patterns with 500ms debounce.",
  WatchInputSchema.shape,
  async ({ url, glob, selector }) => {
    const result = await handleWatch({ url, glob, selector }, state);
    return { content: [{ type: "text" as const, text: result }] };
  },
);

server.tool(
  "status",
  "Get current eyecheck state: reference info, latest check result, watch mode status, and score history.",
  {},
  async () => {
    const result = await handleStatus(state);
    return { content: [{ type: "text" as const, text: result }] };
  },
);

server.tool(
  "set_tokens",
  "Load design tokens from Tailwind config or CSS custom properties for token-aware reporting.",
  SetTokensInputSchema.shape,
  async ({ tailwindConfig, cssFile }) => {
    const result = await handleSetTokens({ tailwindConfig, cssFile }, state);
    return { content: [{ type: "text" as const, text: result }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await stopWatch(state);
    await closeBrowser();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await stopWatch(state);
    await closeBrowser();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`eyecheck MCP server error: ${err}\n`);
  process.exit(1);
});
