# claude-presentation-builder

An agentic Node.js module that generates branded PowerPoint presentations using Claude. You provide a prompt describing what you want and a skill file defining your brand rules — Claude runs a full agentic loop to generate gradient assets, write a `pptxgenjs` build script, execute it, and deliver a finished `.pptx` file.

---

## How it works

The module drives a multi-turn conversation with the Claude API. In each turn Claude can call three tools — `bash`, `write_file`, and `read_file` — to do real work: install packages, generate background images, write and run a Node.js build script. Your app handles none of that; it just waits for the `.pptx` to land at `outputPath`.

```
Your app                        Claude
   │                               │
   │── generatePresentation() ────>│
   │                               │── write_file: gen_gradients.py
   │<── tool execution ────────────│
   │── result ────────────────────>│
   │                               │── bash: python gen_gradients.py
   │<── tool execution ────────────│
   │── result ────────────────────>│
   │                               │── write_file: build.js
   │                               │── bash: node build.js
   │<── tool execution ────────────│
   │── result ────────────────────>│
   │                               │── end_turn
   │<── { outputPath, summary } ───│
```

---

## Installation

```bash
npm install claude-presentation-builder
```

Requires Node.js 18 or later.

---

## Quick start

```js
import { generatePresentation } from "claude-presentation-builder";
import { readFileSync } from "fs";

const skillContent = readFileSync("./my-brand.skill.md", "utf8");

const { outputPath } = await generatePresentation({
  apiKey:       process.env.ANTHROPIC_API_KEY,
  prompt:       "Create a 5-slide executive summary for our Q3 roadmap",
  skillContent,
  outputPath:   "./decks/q3-roadmap.pptx",
});

console.log("Saved to:", outputPath);
```

---

## API Reference

### `generatePresentation(options)`

Returns `Promise<{ outputPath: string, summary: string }>`.

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | ✅ | Your Anthropic API key. Use `process.env.ANTHROPIC_API_KEY` — never hardcode. |
| `prompt` | `string` | ✅ | Natural language description of the presentation to build. Be as specific as you like — number of slides, audience, key messages, data to include. |
| `skillContent` | `string` | ✅ | The full text of your brand/template skill file. This tells Claude exactly how to style the presentation. See [Writing a skill file](#writing-a-skill-file). |
| `outputPath` | `string` | — | Where to write the finished `.pptx`. Accepts absolute or relative paths. Defaults to `./presentation-<timestamp>.pptx` in the current working directory. |
| `workDir` | `string` | — | Directory Claude uses for intermediate files (gradient PNGs, build scripts, etc.). Defaults to a unique folder inside `os.tmpdir()`. Useful to set explicitly if you want to inspect intermediate outputs or cache gradient assets between runs. |
| `model` | `string` | — | Claude model to use. Defaults to `"claude-opus-4-6"`. |
| `maxTokens` | `number` | — | `max_tokens` per API call. Defaults to `8096`. Increase if Claude is truncating long build scripts. |
| `onProgress` | `function` | — | Progress callback invoked throughout the build. Receives a single [event object](#progress-events). Useful for logging, UI progress bars, or debugging. |

#### Return value

```ts
{
  outputPath: string,  // Absolute path to the written .pptx file
  summary:    string,  // Claude's final text response — a short description of what was built
}
```

#### Errors

| Condition | Error message |
|---|---|
| `apiKey` not provided | `claude-presentation-builder: apiKey is required` |
| `prompt` not provided | `claude-presentation-builder: prompt is required` |
| `skillContent` not provided | `claude-presentation-builder: skillContent is required. Pass the text of your brand/template skill file.` |
| Claude completes without producing a file | `claude-presentation-builder: Claude did not produce output.pptx in <workDir>. Check onProgress logs for build errors.` |

---

### Progress events

The `onProgress` callback receives one of these event shapes on each update:

```ts
// An API call is being made
{ type: "api_call", round: number }

// Claude returned a stop reason
{ type: "stop_reason", value: "tool_use" | "end_turn", round: number }

// Claude is invoking a tool
{ type: "tool_call", tool: "bash" | "write_file" | "read_file", input: object }

// A tool has returned its result
{ type: "tool_result", tool: "bash" | "write_file" | "read_file", output: string }

// Claude finished — build is complete
{ type: "complete", text: string }

// Internal log line from the tool executor
{ type: "log", message: string }
```

**Example — simple console logger:**

```js
const { outputPath } = await generatePresentation({
  apiKey, prompt, skillContent,
  onProgress: (e) => {
    if (e.type === "tool_call")   console.log(`⚙  ${e.tool}:`, JSON.stringify(e.input).slice(0, 80));
    if (e.type === "tool_result") console.log(`   → ${String(e.output).slice(0, 100)}`);
    if (e.type === "complete")    console.log("✅ Done");
  },
});
```

**Example — structured logging:**

```js
import pino from "pino";
const log = pino();

onProgress: (e) => log.info(e, "presentation-builder")
```

---

## Writing a skill file

A skill file is a plain Markdown (`.md`) text file that tells Claude how to build your presentation. You load it yourself and pass its content as the `skillContent` parameter. There is no required format — Claude reads it as instructions.

```js
import { readFileSync } from "fs";

const skillContent = readFileSync("./acme-brand.skill.md", "utf8");
```

A well-written skill file typically covers:

- **Background/theme** — how to generate or load slide backgrounds (colors, gradients, images)
- **Typography** — font names, sizes, weights, and colors for each text role
- **Layout library** — named slide layouts with exact positioning and dimensions
- **Brand assets** — where logo and icon files live and how to use them
- **Build workflow** — the step-by-step process Claude must follow (e.g. generate PNGs first, then write the pptxgenjs script, then run it)
- **Critical rules** — hard constraints that must never be violated

**Minimal example skill file:**

```markdown
# Acme Corp Presentation Template

Build presentations using pptxgenjs (npm install pptxgenjs).

## Background
All slides use a solid #1A1A2E background.

## Typography
- Titles: 32pt, bold, white (#FFFFFF), font "Helvetica Neue"
- Body:   14pt, normal, light gray (#CCCCCC), font "Helvetica Neue"

## Footer
Every slide: company name bottom-right, slide number bottom-left. 9pt, #888888.

## Build steps
1. Write build.js using pptxgenjs.
2. Run: npm install pptxgenjs && node build.js
3. Output must be written to output.pptx.
```

> **Tip:** The more precise your skill file, the more consistent the output. Define exact hex codes, font sizes in points, and element positions in inches (pptxgenjs uses inches for all coordinates on a 10" × 5.625" canvas).

---

## Advanced usage

### Inspect intermediate build files

Set `workDir` to a stable path to keep Claude's working files after the build completes — useful for debugging or caching gradient assets.

```js
const { outputPath } = await generatePresentation({
  apiKey, prompt, skillContent,
  outputPath: "./output.pptx",
  workDir:    "./build-cache",
});
// ./build-cache/ will contain gen_gradients.py, bg_warm.png, build.js, output.pptx, etc.
```

### Use a different Claude model

```js
const { outputPath } = await generatePresentation({
  apiKey, prompt, skillContent,
  model: "claude-sonnet-4-6",  // faster and cheaper; may need a more explicit skill file
});
```

### Load skill content from multiple files

Compose your skill from reusable parts:

```js
import { readFileSync } from "fs";

const skillContent = [
  readFileSync("./skills/brand-colors.md", "utf8"),
  readFileSync("./skills/slide-layouts.md", "utf8"),
  readFileSync("./skills/build-workflow.md", "utf8"),
].join("\n\n---\n\n");

const { outputPath } = await generatePresentation({
  apiKey, prompt, skillContent,
});
```

### Batch generation

```js
import { generatePresentation } from "claude-presentation-builder";
import { readFileSync } from "fs";

const skillContent = readFileSync("./my-brand.skill.md", "utf8");

const decks = [
  { prompt: "Q1 business review — 8 slides", output: "./q1-review.pptx" },
  { prompt: "Product roadmap overview — 6 slides", output: "./roadmap.pptx" },
  { prompt: "New hire onboarding deck — 10 slides", output: "./onboarding.pptx" },
];

for (const deck of decks) {
  const { outputPath } = await generatePresentation({
    apiKey: process.env.ANTHROPIC_API_KEY,
    prompt: deck.prompt,
    skillContent,
    outputPath: deck.output,
  });
  console.log("Built:", outputPath);
}
```

---

## Requirements

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- Python 3 with `Pillow` and `numpy` available on `PATH` (required if your skill generates gradient backgrounds — install with `pip install Pillow numpy`)

---

## License

MIT
