import { z } from "zod";

export const ViewportSchema = z.object({
  width: z.number().int().positive().default(1280),
  height: z.number().int().positive().default(720),
});

export type Viewport = z.infer<typeof ViewportSchema>;

export type RendererType = "playwright" | "xcode" | "paparazzi" | "flutter";

export interface ServerConfig {
  defaultViewport: Viewport;
  ssimThreshold: number;
  watchDebounceMs: number;
  networkIdleTimeout: number;
  renderer: RendererType;
}

export const config: ServerConfig = {
  defaultViewport: { width: 1280, height: 720 },
  ssimThreshold: 0.95,
  watchDebounceMs: 500,
  networkIdleTimeout: 2000,
  renderer: "playwright",
};
