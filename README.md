# eyecheck — Visual Verification MCP Server

AI coding assistants are blind to visual output. **eyecheck** lets them see, compare, and self-correct.

An MCP server that renders UIs, compares against design references, and feeds structured visual feedback back to Claude Code so it can fix visual bugs automatically.

---

## Problem

AI coding assistants write UI code without knowing if it looks right. Colors, spacing, layout, typography — all guesswork. This creates a tedious feedback loop: AI writes code, you check it visually, AI tries again.

**eyecheck closes that loop.** It gives the AI eyes: structural comparison via SSIM, semantic analysis via Claude Vision, and actionable fix suggestions — all automatic.

---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│  Claude Code                                          │
│  Uses eyecheck MCP tools to verify visual output      │
│  and self-correct CSS, layout, colors, spacing        │
└──────────────────┬────────────────────────────────────┘
                   │ MCP Protocol (stdio)
                   ▼
┌───────────────────────────────────────────────────────┐
│  eyecheck MCP Server (TypeScript)                     │
│                                                       │
│  Tools: set_reference, check, watch, status,          │
│         set_tokens                                    │
│                                                       │
│  Renderers:                                           │
│    Playwright (web) │ Xcode (SwiftUI)                 │
│    Paparazzi (Compose) │ Flutter (goldens)            │
│                                                       │
│  Features:                                            │
│    Design token awareness (Tailwind, CSS vars)        │
│    File watching with auto-recheck                    │
│    Score history tracking                             │
└──────────────────┬────────────────────────────────────┘
                   │ subprocess (execFile)
                   ▼
┌───────────────────────────────────────────────────────┐
│  eyecheck-core (Rust CLI)                             │
│                                                       │
│  compare:  SSIM + RGBA pixel diff                     │
│  analyze:  Claude Vision semantic analysis            │
│  report:   Combined structural + semantic             │
│                                                       │
│  Outputs: JSON with scores, issues, suggestions       │
└───────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Build the Rust core

```bash
cd core
cargo build --release
```

### 2. Install the MCP server

```bash
cd mcp-server
npm install
npx playwright install chromium
npm run build
```

### 3. Set your API key

The `analyze` command uses Claude Vision for semantic analysis:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Register with Claude Code

```bash
claude mcp add --scope user eyecheck -- node /path/to/eyecheck/mcp-server/dist/index.js
```

Verify:

```bash
claude mcp list
```

---

## MCP Tools

### `set_reference`

Store a design reference image for visual comparison.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `"url"` \| `"file"` \| `"screenshot"` | yes | How to capture the reference |
| `value` | string | yes | URL, file path, or localhost URL |
| `viewport` | `{ width, height }` | no | Viewport size (default: 1280x720) |

**Examples:**

```
# Screenshot a production page
set_reference({ type: "url", value: "https://example.com", viewport: { width: 1920, height: 1080 } })

# Use a local design file
set_reference({ type: "file", value: "/path/to/design-mockup.png" })

# Screenshot localhost during development
set_reference({ type: "screenshot", value: "http://localhost:3000" })
```

### `check`

Render a URL and compare it against the stored reference. Returns SSIM score, pixel diff count, and — when the check fails — a detailed list of visual issues with fix suggestions from Claude Vision.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to render and compare |
| `selector` | string | no | CSS selector to screenshot a specific element |
| `viewport` | `{ width, height }` | no | Viewport size (default: 1280x720) |

**Pass output:**

```
PASS - Visual check passed
  SSIM: 0.9812
  Threshold: 0.95
  Pixel differences: 142 (0.01%)
```

**Fail output:**

```
FAIL - Visual differences detected (score: 0.73)
  SSIM: 0.7324
  Threshold: 0.95
  Pixel differences: 48201 (5.24%)
  Diff image: /tmp/eyecheck/checks/diff-1709471234.png

Issues found:
1. [HIGH] spacing — .card-grid: gap is 16px, should be 24px
   → Fix: Change gap property from 16px to 24px
2. [MEDIUM] color — .btn-primary: background is #3B82F6, should be #2563EB
   → Fix: Update background-color to #2563EB

Summary: The card grid spacing is tighter than the design, and the primary
button color is slightly off. Layout structure matches correctly.
```

### `watch`

Watch source files for changes and automatically re-run visual checks. Uses 500ms debounce.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to check on file changes |
| `glob` | string | yes | Glob pattern for files to watch |
| `selector` | string | no | CSS selector for element-level checks |

**Example:**

```
watch({ url: "http://localhost:3000", glob: "src/**/*.{tsx,css}" })
```

Results are logged to stderr on each file change.

### `status`

Get current server state: reference info, latest check result, watch mode, and score history.

```
=== eyecheck status ===

Reference:
  Type: url
  Source: https://example.com
  Dimensions: 1920x1080
  Set at: 2026-03-03T07:15:00.000Z

Latest check:
  Result: FAIL
  SSIM: 0.7324
  Diff: 5.24%
  URL: http://localhost:3000
  Checked at: 2026-03-03T07:16:30.000Z

Watch mode: Active
  Watching: src/**/*.{tsx,css}
  URL: http://localhost:3000
  Started: 2026-03-03T07:16:00.000Z

Score history (last 3):
  2026-03-03T07:14:00Z | SSIM: 0.6201 | http://localhost:3000
  2026-03-03T07:15:30Z | SSIM: 0.7324 | http://localhost:3000
  2026-03-03T07:16:30Z | SSIM: 0.9812 | http://localhost:3000
```

### `set_tokens`

Load design tokens from Tailwind config or CSS custom properties. When tokens are loaded, check reports will map raw CSS values to token names (e.g., `#2563EB` → `var(--color-primary)`, `24px` → `spacing-6`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tailwindConfig` | string | no | Path to `tailwind.config.js` |
| `cssFile` | string | no | Path to CSS file with custom properties |

At least one parameter must be provided. Both can be provided to merge tokens from multiple sources.

**Example:**

```
set_tokens({ cssFile: "src/styles/variables.css" })

# Output:
Design tokens loaded successfully.
  Sources: CSS: src/styles/variables.css
  Colors: 12 tokens
  Spacing: 8 tokens
  Font sizes: 5 tokens
```

**Token-aware check output (with tokens loaded):**

```
1. [HIGH] spacing — .card-grid: gap is 16px (spacing-4), should be 24px (spacing-6)
   → Fix: Change gap property from 16px to 24px
```

---

## Rust CLI

The core binary can also be used standalone:

### `compare` — Structural pixel comparison

```bash
eyecheck-core compare \
  --baseline design.png \
  --test screenshot.png \
  --threshold 0.95 \
  --output diff.png \
  --json
```

Returns SSIM score, pass/fail, diff pixel count, and generates a visual diff overlay.

```json
{
  "ssim_score": 0.7324,
  "passed": false,
  "diff_pixels": 48201,
  "total_pixels": 921600,
  "diff_percentage": 5.23,
  "diff_image_path": "diff.png"
}
```

### `analyze` — Semantic analysis via Claude Vision

```bash
eyecheck-core analyze \
  --reference design.png \
  --render screenshot.png \
  --context "hero section with CTA button" \
  --json
```

Sends both images to Claude Vision API for semantic comparison. Returns match score, categorized issues, and fix suggestions.

```json
{
  "match_score": 0.72,
  "issues": [
    {
      "issue_type": "spacing",
      "element": ".card-grid",
      "actual": "gap is 16px",
      "expected": "gap should be 24px",
      "severity": "high",
      "suggestion": "Change gap property from 16px to 24px"
    }
  ],
  "summary": "Card grid spacing is tighter than design. Colors and typography match."
}
```

### `report` — Combined structural + semantic

```bash
eyecheck-core report \
  --reference design.png \
  --render screenshot.png \
  --threshold 0.95 \
  --output diff.png \
  --json
```

Runs both `compare` and `analyze`, merging results. Passes only if SSIM >= threshold AND semantic match_score >= 0.8.

---

## Supported Renderers

### Web (Playwright) — default

Renders any URL in headless Chromium. Works with static HTML, React, Vue, Svelte, Next.js, and any framework with a dev server.

```
renderer: "playwright"
```

### SwiftUI (Xcode)

Runs `xcodebuild test` to generate SwiftUI preview snapshots. Extracts screenshots from `.xcresult` bundles or falls back to swift-snapshot-testing's `__Snapshots__/` directory.

```typescript
import { renderPreview } from "./renderers/xcode.js";

await renderPreview(
  "MyApp",                                      // scheme
  "platform=iOS Simulator,name=iPhone 16",       // destination
  "ContentView_Preview",                         // preview name
  "/tmp/preview.png"                             // output path
);
```

**Requires:** Xcode + Xcode Command Line Tools

### Android Compose (Paparazzi)

Runs Gradle with [Paparazzi](https://github.com/cashapp/paparazzi) for headless Compose snapshot rendering. No emulator needed — pure JVM rendering.

```typescript
import { recordSnapshots } from "./renderers/paparazzi.js";

await recordSnapshots(
  "/path/to/android/project",  // project root (must have gradlew)
  "app",                       // module
  "com.example.ButtonTest",    // optional composable filter
  "/tmp/snapshots"             // output directory
);
```

**Requires:** Gradle wrapper (`gradlew`) in project root

### Flutter (Golden Tests)

Runs `flutter test --update-goldens` to generate golden test images.

```typescript
import { updateGoldens } from "./renderers/flutter.js";

await updateGoldens(
  "/path/to/flutter/project",   // project root
  "test/widgets/button_test.dart",  // optional test filter
  "test/goldens"                // optional golden directory
);
```

**Requires:** Flutter SDK on PATH

---

## Design Tokens

eyecheck can read your design tokens and use them to enhance check reports, mapping raw CSS values to their token names.

### Supported sources

**CSS custom properties:**

```css
:root {
  --color-primary: #2563EB;
  --color-secondary: #64748B;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --font-size-base: 16px;
  --font-size-lg: 18px;
}
```

**Tailwind config:**

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: "#2563EB",
        secondary: "#64748B",
      },
      spacing: {
        sm: "8px",
        md: "16px",
      },
      fontSize: {
        base: "16px",
        lg: "18px",
      },
    },
  },
};
```

### How it works

1. Call `set_tokens` with your CSS file or Tailwind config path
2. eyecheck extracts colors, spacing, and font size tokens
3. Subsequent `check` calls map raw values in issue reports to token names:
   - `#2563EB` → `var(--color-primary)`
   - `24px` → `spacing-6`
   - `18px` → `font-lg`

---

## Example Workflow

```
User: "Build a hero section matching the Figma design"

Claude Code:
1. Generates HTML/CSS
2. set_reference({ type: "url", value: "https://figma.com/proto/..." })
3. set_tokens({ cssFile: "src/styles/tokens.css" })
4. check({ url: "http://localhost:3000" })

   → FAIL - Visual differences detected (score: 0.73)
     Issues found:
     1. [HIGH] spacing — .hero-cta: padding is 12px (spacing-3), should be 16px (spacing-4)
     2. [MEDIUM] color — .hero-bg: background is #1E3A5F, should be #1E40AF (var(--color-primary-dark))

5. Fixes CSS based on suggestions
6. check({ url: "http://localhost:3000" })

   → PASS - Visual check passed (SSIM: 0.9812)

7. Reports: "Visual verification passed. Hero section matches design."
```

---

## Server Configuration

The MCP server uses these defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `defaultViewport` | `1280x720` | Default browser viewport for rendering |
| `ssimThreshold` | `0.95` | SSIM score threshold for pass/fail |
| `watchDebounceMs` | `500` | Debounce time for file watch changes |
| `networkIdleTimeout` | `2000` | Wait time for network idle during rendering |
| `renderer` | `"playwright"` | Active renderer (`playwright`, `xcode`, `paparazzi`, `flutter`) |

These are set in `mcp-server/src/config.ts`.

---

## Testing

### Rust unit tests

```bash
cd core && cargo test
```

7 tests covering:
- SSIM scoring (identical images → ~1.0, different images → <0.95)
- Diff pixel counting and percentage calculation
- Diff image generation and dimension validation
- Test fixture generation

### TypeScript integration tests

```bash
cd mcp-server && npx tsx ../test/integration.test.ts
```

9 tests covering:
- Config defaults (viewport, threshold, debounce, renderer)
- CSS custom property extraction
- Token value-to-name mapping
- Core bridge compare with fixture images (requires built Rust binary)

---

## Project Structure

```
eyecheck/
├── core/                          # Rust comparison engine
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                # CLI: compare, analyze, report
│       ├── compare.rs             # SSIM + RGBA pixel comparison
│       ├── analyze.rs             # Claude Vision semantic analysis
│       ├── diff_image.rs          # Visual diff overlay generation
│       └── report.rs              # Combined comparison report
├── mcp-server/                    # TypeScript MCP server
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts               # Server entry point, tool registration
│       ├── config.ts              # Server configuration
│       ├── core-bridge.ts         # Rust binary subprocess bridge
│       ├── tokens.ts              # Design token extraction
│       ├── renderers/
│       │   ├── playwright.ts      # Web renderer (Chromium)
│       │   ├── xcode.ts           # SwiftUI renderer
│       │   ├── paparazzi.ts       # Android Compose renderer
│       │   └── flutter.ts         # Flutter golden renderer
│       └── tools/
│           ├── set-reference.ts   # Reference setup handler
│           ├── check.ts           # Visual comparison handler
│           ├── watch.ts           # File watching handler
│           ├── status.ts          # Status reporting
│           └── set-tokens.ts      # Design token loader
└── test/
    ├── fixtures/                  # Test images (generated by cargo test)
    │   ├── reference.png          # 100x100 blue square
    │   ├── render-match.png       # 100x100 blue square (identical)
    │   └── render-diff.png        # 100x100 red square (different)
    └── integration.test.ts        # TypeScript integration tests
```

---

## Requirements

- **Rust 1.85+** — builds the core comparison engine ([install](https://rustup.rs/))
- **Node.js 18+** — runs the MCP server ([install](https://nodejs.org/))
- **Chromium** — installed via Playwright for web rendering
- **ANTHROPIC_API_KEY** — required for `analyze` command (Claude Vision API)

### Optional (for native renderers)

- **Xcode + Command Line Tools** — for SwiftUI rendering
- **Gradle + Paparazzi** — for Android Compose rendering
- **Flutter SDK** — for Flutter golden tests

---

## Troubleshooting

### "eyecheck-core not found"

The MCP server looks for the binary at `core/target/release/eyecheck-core`, then `core/target/debug/eyecheck-core`, then on PATH. Build it:

```bash
cd core && cargo build --release
```

### "Playwright browsers not installed"

```bash
cd mcp-server && npx playwright install chromium
```

### "ANTHROPIC_API_KEY not set"

The `analyze` and `report` commands require a Claude API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

The `compare` command works without it (structural comparison only).

### "MCP tool not showing in Claude Code"

```bash
claude mcp list                    # check registration
claude mcp remove eyecheck        # remove if misconfigured
claude mcp add --scope user eyecheck -- node /path/to/mcp-server/dist/index.js
```

---

## License

MIT
