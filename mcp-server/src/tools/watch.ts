import { z } from "zod";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { config } from "../config.js";
import { handleCheck } from "./check.js";
import type { ServerState } from "../index.js";

export const WatchInputSchema = z.object({
  url: z.string().describe("URL to check on file changes"),
  glob: z.string().describe("Glob pattern for files to watch"),
  selector: z.string().optional().describe("CSS selector for element-level checks"),
});

export type WatchInput = z.infer<typeof WatchInputSchema>;

let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function handleWatch(
  input: WatchInput,
  state: ServerState,
): Promise<string> {
  // Stop existing watcher if any
  await stopWatch(state);

  if (!state.reference) {
    return "No reference set. Use set_reference first before starting watch mode.";
  }

  watcher = chokidarWatch(input.glob, {
    ignoreInitial: true,
    ignored: /(^|[/\\])\../, // ignore dotfiles
  });

  watcher.on("change", (changedPath) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const report = await handleCheck(
          { url: input.url, selector: input.selector },
          state,
        );
        // Log to stderr so it doesn't interfere with MCP stdio
        process.stderr.write(
          `\n[eyecheck watch] File changed: ${changedPath}\n${report}\n`,
        );
      } catch (err) {
        process.stderr.write(
          `\n[eyecheck watch] Error during check: ${err}\n`,
        );
      }
    }, config.watchDebounceMs);
  });

  state.watchMode = {
    active: true,
    glob: input.glob,
    url: input.url,
    startedAt: new Date().toISOString(),
  };

  return [
    `Watch mode started.`,
    `  Watching: ${input.glob}`,
    `  URL: ${input.url}`,
    `  Debounce: ${config.watchDebounceMs}ms`,
    input.selector ? `  Selector: ${input.selector}` : null,
    ``,
    `File changes will trigger automatic visual checks.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function stopWatch(state: ServerState): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  state.watchMode = null;
}
