/**
 * claude-presentation-builder
 *
 * Agentic AI-powered presentation builder. Pass a prompt describing what
 * you want and a skill file defining your brand/template rules — Claude
 * drives a full agentic loop to generate, build, and write a .pptx file.
 *
 * Usage:
 *
 *   import { generatePresentation } from "claude-presentation-builder";
 *   import { readFileSync } from "fs";
 *
 *   const skillContent = readFileSync("./my-brand.skill.md", "utf8");
 *
 *   const { outputPath } = await generatePresentation({
 *     apiKey:       process.env.ANTHROPIC_API_KEY,
 *     prompt:       "Create a 5-slide deck about our Q3 roadmap",
 *     skillContent,
 *     outputPath:   "./decks/q3-roadmap.pptx",
 *   });
 *
 *   console.log("Saved to:", outputPath);
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import os from "os";
import { TOOL_DEFINITIONS, createToolExecutor } from "./src/tools.js";
import { runAgenticLoop } from "./src/loop.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a branded PowerPoint presentation using an agentic Claude loop.
 *
 * @param {object}   options
 * @param {string}   options.apiKey        Anthropic API key (required)
 * @param {string}   options.prompt        What the presentation should be about (required)
 * @param {string}   options.skillContent  Brand/template instructions for Claude (required).
 *                                         Typically the text content of a Markdown skill file.
 * @param {string}   [options.outputPath]  Where to save the finished .pptx file.
 *                                         Defaults to ./presentation-<timestamp>.pptx
 * @param {string}   [options.workDir]     Directory for intermediate build files (gradients,
 *                                         scripts, etc.). Defaults to a temp folder under
 *                                         os.tmpdir() that is unique per call.
 * @param {string}   [options.model]       Claude model to use.
 *                                         Defaults to "claude-opus-4-6".
 * @param {number}   [options.maxTokens]   max_tokens per API call. Defaults to 8096.
 * @param {Function} [options.onProgress]  Progress callback invoked throughout the build.
 *                                         Receives a single event object — see Event Types.
 *
 * @returns {Promise<{ outputPath: string, summary: string }>}
 *   outputPath — absolute path to the written .pptx file
 *   summary    — Claude's final text response (a short description of what was built)
 *
 * @throws {Error} if apiKey, prompt, or skillContent are missing
 * @throws {Error} if Claude completes without writing output.pptx to workDir
 */
export async function generatePresentation({
  apiKey,
  prompt,
  skillContent,
  outputPath,
  workDir,
  model = "claude-opus-4-6",
  maxTokens = 8096,
  onProgress = () => {},
}) {
  // ── Validate ──────────────────────────────────────────────────────────────
  if (!apiKey)
    throw new Error("claude-presentation-builder: apiKey is required");
  if (!prompt)
    throw new Error("claude-presentation-builder: prompt is required");
  if (!skillContent)
    throw new Error(
      "claude-presentation-builder: skillContent is required. " +
        "Pass the text of your brand/template skill file. " +
        "Example: readFileSync('./my-brand.skill.md', 'utf8')"
    );

  // ── Resolve paths ─────────────────────────────────────────────────────────
  const resolvedWorkDir =
    workDir ?? path.join(os.tmpdir(), `cpb-${Date.now()}`);

  const resolvedOutputPath =
    outputPath ?? path.resolve(`presentation-${Date.now()}.pptx`);

  const absoluteOutputPath = path.isAbsolute(resolvedOutputPath)
    ? resolvedOutputPath
    : path.resolve(resolvedOutputPath);

  fs.mkdirSync(resolvedWorkDir, { recursive: true });
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });

  // ── Wire up tools ─────────────────────────────────────────────────────────
  const executeTools = createToolExecutor(resolvedWorkDir, (msg) =>
    onProgress({ type: "log", message: msg })
  );

  // ── Run the agentic loop ──────────────────────────────────────────────────
  const client = new Anthropic({ apiKey });

  const summary = await runAgenticLoop({
    client,
    model,
    maxTokens,
    systemPrompt: buildSystemPrompt(skillContent, resolvedWorkDir),
    userMessage: prompt,
    tools: TOOL_DEFINITIONS,
    executeTools,
    onProgress,
  });

  // ── Copy output to the requested destination ──────────────────────────────
  const builtFile = path.join(resolvedWorkDir, "output.pptx");

  if (!fs.existsSync(builtFile)) {
    throw new Error(
      `claude-presentation-builder: Claude did not produce output.pptx in ${resolvedWorkDir}.\n` +
        `Check onProgress logs for build errors.`
    );
  }

  fs.copyFileSync(builtFile, absoluteOutputPath);

  return { outputPath: absoluteOutputPath, summary };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSystemPrompt(skillContent, workDir) {
  return `\
You are a presentation builder. Build a PowerPoint presentation by following
the brand and template instructions below exactly.

You have three tools:
- bash       → run shell commands (Python, Node.js, npm install, etc.)
- write_file → write a file to disk
- read_file  → read a file from disk

Working directory: ${workDir}
The finished presentation MUST be written to: ${workDir}/output.pptx

IMPORTANT: Do NOT narrate steps or output tool-call syntax as text.
Actually USE the tools to execute every step.

---

${skillContent}
`;
}
