import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ── Tool definitions sent to the Claude API ───────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "bash",
    description:
      "Execute a bash command in the working directory. Use this to: run Python scripts " +
      "(e.g. generate gradient PNGs), install npm packages, run Node.js scripts to build " +
      "the .pptx file, and inspect the filesystem. Always prefer writing scripts to disk " +
      "first via write_file, then executing them with bash.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "write_file",
    description:
      "Write text content to a file. Use this to create Python scripts, Node.js scripts, " +
      "and any other files needed during the build. Paths are relative to the working directory " +
      "unless absolute.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path (relative to working directory, or absolute).",
        },
        content: {
          type: "string",
          description: "Full text content to write.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file. Use this to inspect generated files, check for errors, " +
      "or verify output.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path (relative to working directory, or absolute).",
        },
      },
      required: ["path"],
    },
  },
];

// ── Tool executor factory ─────────────────────────────────────────────────────

/**
 * Returns an executeTools(name, input) function bound to a specific workDir.
 * Any error is caught and returned as a string so Claude can self-correct.
 *
 * @param {string} workDir  Absolute path to the working directory
 * @param {Function} [log]  Optional log(message) callback for progress output
 */
export function createToolExecutor(workDir, log = () => {}) {
  fs.mkdirSync(workDir, { recursive: true });

  return function executeTools(toolName, toolInput) {
    log(`[tool:${toolName}] ${JSON.stringify(toolInput).slice(0, 120)}`);

    try {
      // ── bash ──────────────────────────────────────────────────────────────
      if (toolName === "bash") {
        const output = execSync(toolInput.command, {
          cwd: workDir,
          timeout: 120_000, // 2 min per command
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        const trimmed = (output || "(no output)").slice(0, 4000);
        log(`[output] ${trimmed.slice(0, 200)}`);
        return trimmed;
      }

      // ── write_file ────────────────────────────────────────────────────────
      if (toolName === "write_file") {
        const filePath = path.isAbsolute(toolInput.path)
          ? toolInput.path
          : path.join(workDir, toolInput.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, toolInput.content, "utf8");
        log(`[written] ${filePath}`);
        return `File written: ${filePath}`;
      }

      // ── read_file ─────────────────────────────────────────────────────────
      if (toolName === "read_file") {
        const filePath = path.isAbsolute(toolInput.path)
          ? toolInput.path
          : path.join(workDir, toolInput.path);
        const content = fs.readFileSync(filePath, "utf8");
        log(`[read] ${filePath} (${content.length} chars)`);
        return content.slice(0, 8000); // cap to avoid blowing context
      }

      return `Unknown tool: ${toolName}`;
    } catch (err) {
      // Return error text — lets Claude read it and self-correct
      const msg = `ERROR: ${err.message}\n${err.stderr ?? ""}`.trim();
      log(`[error] ${msg.slice(0, 300)}`);
      return msg;
    }
  };
}
