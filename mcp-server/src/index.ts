#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SetReferenceInputSchema, handleSetReference } from "./tools/set-reference.js";
import { CheckInputSchema, handleCheck } from "./tools/check.js";
import { WatchInputSchema, handleWatch, stopWatch } from "./tools/watch.js";
import { handleStatus } from "./tools/status.js";
import { SetTokensInputSchema, handleSetTokens } from "./tools/set-tokens.js";
import { ApproveInputSchema, handleApprove } from "./tools/approve.js";
import { HistoryInputSchema, handleHistory } from "./tools/history.js";
import { initDb, getLatestBaseline } from "./storage.js";
import type { TokenMap } from "./tokens.js";
import { closeBrowser } from "./renderers/playwright.js";
import { existsSync } from "node:fs";

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
  async ({ type, value, viewport, name }) => {
    const result = await handleSetReference({ type, value, viewport, name }, state);
    return { content: [{ type: "text" as const, text: result }] };
  },
);

server.tool(
  "check",
  "Render a URL and compare it against the stored reference image. Reports SSIM score, pixel differences, and detailed analysis of visual discrepancies.",
  CheckInputSchema.shape,
  async ({ url, selector, viewport, viewports }) => {
    const result = await handleCheck({ url, selector, viewport, viewports }, state);
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

server.tool(
  "approve",
  "Approve the latest check result as the new baseline. Replaces the current reference with the most recent test render.",
  ApproveInputSchema.shape,
  async ({ name }) => {
    const result = await handleApprove({ name }, state);
    return { content: [{ type: "text" as const, text: result }] };
  },
);

server.tool(
  "history",
  "View comparison history for a named baseline. Shows SSIM scores, pass/fail status, and diff percentages over time.",
  HistoryInputSchema.shape,
  async ({ name, limit }) => {
    const result = await handleHistory({ name, limit });
    return { content: [{ type: "text" as const, text: result }] };
  },
);

async function main() {
  // Initialize SQLite database
  initDb();

  // Restore latest baseline from DB into in-memory state for session continuity
  const latestBaseline = getLatestBaseline();
  if (latestBaseline && existsSync(latestBaseline.image_path)) {
    state.reference = {
      type: latestBaseline.url ? "url" : "file",
      source: latestBaseline.url ?? latestBaseline.image_path,
      path: latestBaseline.image_path,
      dimensions: {
        width: latestBaseline.viewport_width,
        height: latestBaseline.viewport_height,
      },
      setAt: latestBaseline.updated_at,
    };
  }

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
