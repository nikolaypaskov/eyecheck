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
│         set_tokens, approve, history                  │
│                                                       │
│  Renderers:                                           │
│    Playwright (web) │ Xcode (SwiftUI)                 │
│    Paparazzi (Compose) │ Flutter (goldens)            │
│                                                       │
│  Features:                                            │
│    SQLite persistence (baselines + comparison history)│
│    Multi-viewport responsive testing                  │
│    Design token awareness (Tailwind, CSS vars)        │
│    File watching with auto-recheck                    │
│    Score history tracking                             │
└──────────────────┬────────────────────────────────────┘
                   │ subprocess (execFile)
                   ▼
┌───────────────────────────────────────────────────────┐
│  eyecheck-core (Rust CLI)                             │
│                                                       │
│  compare:  SSIM + YIQ perceptual diff + anti-aliasing │
│  analyze:  Claude Vision semantic analysis            │
│  report:   Combined structural + semantic             │
│  batch:    CI/CD batch comparison with JUnit output   │
│                                                       │
│  Performance: Rayon parallel rows, region clustering  │
│  Outputs: JSON with scores, regions, suggestions      │
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
| `name` | string | no | Name for this baseline (default: auto-generated from URL hostname) |

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
| `viewports` | `[{ width, height, label? }]` | no | Multiple viewports for responsive testing |

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
  Anti-aliased pixels: 1203 (filtered)
  Diff image: /tmp/eyecheck/checks/diff-1709471234.png

Regions: 2 changed areas
  Region 1: (100, 50) 200x40 — 3420 pixels
  Region 2: (300, 200) 80x20 — 890 pixels

Issues found:
1. [HIGH] spacing — .card-grid: gap is 16px, should be 24px
   → Fix: Change gap property from 16px to 24px
2. [MEDIUM] color — .btn-primary: background is #3B82F6, should be #2563EB
   → Fix: Update background-color to #2563EB

Summary: The card grid spacing is tighter than the design, and the primary
button color is slightly off. Layout structure matches correctly.
```

**Multi-viewport output:**

```
=== Responsive Check: http://localhost:3000 ===

[mobile 375x812] PASS — SSIM: 0.9921 | Diff: 0.42%
[tablet 768x1024] FAIL — SSIM: 0.8734 | Diff: 12.45%
  1. [HIGH] layout — .sidebar: collapsed on tablet, should be visible
[desktop 1280x720] PASS — SSIM: 0.9856 | Diff: 1.23%

Overall: FAIL (1 of 3 viewports failed)
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

### `approve`

Approve the current render as the new baseline. Useful after a failed check when the new visual state is intentional.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Baseline name to approve (defaults to most recent) |

```
approve({ name: "homepage" })

# Output:
Baseline "homepage" approved and updated.
  Previous SSIM: 0.8734
  Updated at: 2026-03-03T08:00:00.000Z
  The current render is now the new baseline.
```

### `history`

View comparison history for a named baseline.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Baseline name to view history for |
| `limit` | number | no | Number of recent comparisons (default: 20) |

```
history({ name: "homepage", limit: 5 })

# Output:
=== History for "homepage" (1280x720) ===

  2026-03-03T07:14:00Z | FAIL | SSIM: 0.6201 | Diff: 12.45%
  2026-03-03T07:15:30Z | FAIL | SSIM: 0.7324 | Diff: 5.24%
  2026-03-03T07:16:30Z | PASS | SSIM: 0.9812 | Diff: 0.01%

Total comparisons: 3
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

Returns SSIM score, pass/fail, diff pixel count, anti-aliased pixel count, diff regions, and generates a visual diff overlay.

```json
{
  "ssim_score": 0.7324,
  "passed": false,
  "diff_pixels": 48201,
  "total_pixels": 921600,
  "diff_percentage": 5.23,
  "antialiased_pixels": 1203,
  "diff_image_path": "diff.png",
  "regions": [
    { "x": 100, "y": 50, "width": 200, "height": 40, "pixel_count": 3420 },
    { "x": 300, "y": 200, "width": 80, "height": 20, "pixel_count": 890 }
  ]
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

### `batch` — CI/CD batch comparison

```bash
eyecheck-core batch \
  --config eyecheck.ci.json \
  --output-dir ./diffs \
  --junit report.xml \
  --json
```

Runs multiple comparisons from a JSON config file. Designed for CI pipelines.

**Exit codes:** 0 = all pass, 1 = any fail, 2 = any error.

**Config format** (`eyecheck.ci.json`):

```json
{
  "checks": [
    { "name": "homepage", "baseline": "baselines/home.png", "test": "screenshots/home.png" },
    { "name": "about", "baseline": "baselines/about.png", "test": "screenshots/about.png" },
    { "name": "login", "baseline": "baselines/login.png", "test": "screenshots/login.png", "threshold": 0.98 }
  ],
  "threshold": 0.95,
  "ignore_antialiasing": true
}
```

See `eyecheck.ci.example.json` for a ready-to-use template.

### Anti-aliasing filtering

All compare commands support `--ignore-antialiasing` (default: true), which filters out sub-pixel font rendering and anti-aliased edge differences using Pixelmatch's YIQ perceptual color delta algorithm. This reduces false positives by 40%+ on typical web pages.

```bash
eyecheck-core compare --baseline a.png --test b.png --ignore-antialiasing --json
```

The diff image uses distinct colors: red for real differences, yellow for filtered anti-aliased pixels.

---

## CI/CD Integration

A ready-to-use GitHub Actions workflow is provided at `.github/workflows/visual-regression.yml`. It:

1. Builds eyecheck-core
2. Starts your dev server
3. Runs `eyecheck-core batch` against baselines in your repo
4. Uploads diff images as artifacts on failure
5. Posts a PR comment with a results table

Copy it to your project and customize the dev server command and config path.

---

## Persistence

eyecheck persists baselines and comparison history across sessions using SQLite.

- **Database:** `~/.eyecheck/eyecheck.db`
- **Images:** `~/.eyecheck/images/{name}/{viewport}.png`

On server start, the last baseline is automatically restored so you don't need to re-set your reference after restarting. Use `approve` to promote a failed check as the new baseline, and `history` to track visual quality over time.

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

20 tests covering:
- SSIM scoring (identical images → ~1.0, different images → <0.95)
- Diff pixel counting and percentage calculation
- Diff image generation and dimension validation
- YIQ perceptual color delta and alpha blending
- Anti-aliasing detection (solid regions, edge pixels)
- Connected-component region clustering (single/multiple regions, noise filtering)
- Batch config parsing and defaults
- JUnit XML generation and XML escaping

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
│       ├── main.rs                # CLI: compare, analyze, report, batch
│       ├── compare.rs             # SSIM + YIQ perceptual pixel diff (Rayon parallel)
│       ├── analyze.rs             # Claude Vision semantic analysis
│       ├── diff_image.rs          # Visual diff overlay (region-aware coloring)
│       ├── report.rs              # Combined comparison report
│       ├── yiq.rs                 # YIQ perceptual color delta (Pixelmatch port)
│       ├── antialiasing.rs        # Anti-aliasing detection
│       ├── clustering.rs          # Connected-component region grouping
│       ├── batch.rs               # CI/CD batch comparison runner
│       └── junit.rs               # JUnit XML report output
├── mcp-server/                    # TypeScript MCP server
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts               # Server entry point, tool registration, DB init
│       ├── config.ts              # Server configuration
│       ├── core-bridge.ts         # Rust binary subprocess bridge
│       ├── storage.ts             # SQLite + filesystem persistence
│       ├── tokens.ts              # Design token extraction
│       ├── renderers/
│       │   ├── playwright.ts      # Web renderer (Chromium, multi-viewport)
│       │   ├── xcode.ts           # SwiftUI renderer
│       │   ├── paparazzi.ts       # Android Compose renderer
│       │   └── flutter.ts         # Flutter golden renderer
│       └── tools/
│           ├── set-reference.ts   # Reference setup (persists to SQLite)
│           ├── check.ts           # Visual comparison (single + multi-viewport)
│           ├── watch.ts           # File watching handler
│           ├── status.ts          # Status reporting (DB-aware)
│           ├── approve.ts         # Approve current render as new baseline
│           ├── history.ts         # View comparison history
│           └── set-tokens.ts      # Design token loader
├── .github/workflows/
│   └── visual-regression.yml      # GitHub Actions CI template
├── eyecheck.ci.example.json       # Example batch config for CI
└── test/
    ├── fixtures/                  # Test images (generated by cargo test)
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
