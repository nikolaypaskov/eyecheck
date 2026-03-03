import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

// ----- Config tests -----

describe("config", () => {
  it("has correct default viewport", async () => {
    const { config } = await import("../mcp-server/src/config.js");
    assert.deepStrictEqual(config.defaultViewport, { width: 1280, height: 720 });
  });

  it("has correct default SSIM threshold", async () => {
    const { config } = await import("../mcp-server/src/config.js");
    assert.strictEqual(config.ssimThreshold, 0.95);
  });

  it("has correct watch debounce", async () => {
    const { config } = await import("../mcp-server/src/config.js");
    assert.strictEqual(config.watchDebounceMs, 500);
  });

  it("has correct default renderer", async () => {
    const { config } = await import("../mcp-server/src/config.js");
    assert.strictEqual(config.renderer, "playwright");
  });
});

// ----- Token extraction tests -----

describe("token extraction", () => {
  it("extracts CSS custom properties", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const tmpDir = path.join(tmpdir(), "eyecheck-test-tokens");
    await mkdir(tmpDir, { recursive: true });
    const cssPath = path.join(tmpDir, "test-vars.css");

    await writeFile(
      cssPath,
      `:root {
  --color-primary: #2563EB;
  --color-secondary: #64748B;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --font-size-base: 16px;
  --font-size-lg: 18px;
}`,
    );

    const { extractCssCustomProperties } = await import("../mcp-server/src/tokens.js");
    const tokens = await extractCssCustomProperties(cssPath);

    assert.strictEqual(tokens.colors["color-primary"], "#2563EB");
    assert.strictEqual(tokens.colors["color-secondary"], "#64748B");
    assert.strictEqual(tokens.spacing["spacing-sm"], "8px");
    assert.strictEqual(tokens.spacing["spacing-md"], "16px");
    assert.strictEqual(tokens.spacing["spacing-lg"], "24px");
  });

  it("maps values to tokens", async () => {
    const { mapValueToToken } = await import("../mcp-server/src/tokens.js");
    const tokens = {
      colors: { "color-primary": "#2563EB" } as Record<string, string>,
      spacing: { "4": "16px", "6": "24px" } as Record<string, string>,
      fontSize: { "lg": "18px" } as Record<string, string>,
    };

    assert.strictEqual(mapValueToToken("#2563EB", tokens), "var(--color-primary)");
    assert.strictEqual(mapValueToToken("16px", tokens), "spacing-4");
    assert.strictEqual(mapValueToToken("18px", tokens), "font-lg");
    assert.strictEqual(mapValueToToken("99px", tokens), null);
  });

  it("returns empty map for empty CSS", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const tmpDir = path.join(tmpdir(), "eyecheck-test-tokens");
    await mkdir(tmpDir, { recursive: true });
    const cssPath = path.join(tmpDir, "empty.css");
    await writeFile(cssPath, "body { margin: 0; }");

    const { extractCssCustomProperties } = await import("../mcp-server/src/tokens.js");
    const tokens = await extractCssCustomProperties(cssPath);

    assert.deepStrictEqual(tokens.colors, {});
    assert.deepStrictEqual(tokens.spacing, {});
    assert.deepStrictEqual(tokens.fontSize, {});
  });
});

// ----- Core bridge tests (require built Rust binary) -----

describe("core-bridge", () => {
  let binaryAvailable = false;

  before(async () => {
    // Check if the Rust binary and fixtures exist
    const debugBin = path.join(__dirname, "../core/target/debug/eyecheck-core");
    const releaseBin = path.join(__dirname, "../core/target/release/eyecheck-core");
    try {
      await access(debugBin);
      binaryAvailable = true;
    } catch {
      try {
        await access(releaseBin);
        binaryAvailable = true;
      } catch {
        console.log("Skipping core-bridge tests: Rust binary not built");
      }
    }
  });

  it("compare returns correct shape for identical images", async () => {
    if (!binaryAvailable) return;

    const { compare } = await import("../mcp-server/src/core-bridge.js");
    const ref = path.join(fixturesDir, "reference.png");
    const match = path.join(fixturesDir, "render-match.png");

    try {
      await access(ref);
      await access(match);
    } catch {
      console.log("Skipping: test fixtures not generated yet");
      return;
    }

    const result = await compare(ref, match);
    assert.strictEqual(typeof result.ssim_score, "number");
    assert.strictEqual(typeof result.passed, "boolean");
    assert.strictEqual(typeof result.diff_pixels, "number");
    assert.strictEqual(typeof result.total_pixels, "number");
    assert.strictEqual(typeof result.diff_percentage, "number");
    assert.ok(result.ssim_score > 0.99, `Expected high SSIM, got ${result.ssim_score}`);
    assert.ok(result.passed, "Identical images should pass");
  });

  it("compare returns lower score for different images", async () => {
    if (!binaryAvailable) return;

    const { compare } = await import("../mcp-server/src/core-bridge.js");
    const ref = path.join(fixturesDir, "reference.png");
    const diff = path.join(fixturesDir, "render-diff.png");

    try {
      await access(ref);
      await access(diff);
    } catch {
      console.log("Skipping: test fixtures not generated yet");
      return;
    }

    const result = await compare(ref, diff);
    assert.ok(result.ssim_score < 0.95, `Expected low SSIM, got ${result.ssim_score}`);
    assert.ok(!result.passed, "Different images should fail");
    assert.ok(result.diff_pixels > 0, "Should have pixel differences");
  });
});
