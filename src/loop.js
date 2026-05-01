/**
 * runAgenticLoop
 *
 * Drives a multi-turn Claude conversation that can call tools. Keeps running
 * until Claude returns stop_reason === "end_turn" (no more tool calls).
 *
 * @param {object}   opts
 * @param {object}   opts.client         Anthropic SDK client instance
 * @param {string}   opts.model          Model string, e.g. "claude-opus-4-6"
 * @param {number}   opts.maxTokens      max_tokens for each API call
 * @param {string}   opts.systemPrompt   System prompt passed to every call
 * @param {string}   opts.userMessage    The initial user message
 * @param {Array}    opts.tools          Tool definition array (TOOL_DEFINITIONS)
 * @param {Function} opts.executeTools   (toolName, toolInput) => string
 * @param {Function} [opts.onProgress]   Optional (event) => void progress callback
 *                                       event: { type, tool?, input?, output?, text? }
 *
 * @returns {Promise<string>}  The final text response from Claude
 */
export async function runAgenticLoop({
  client,
  model,
  maxTokens,
  systemPrompt,
  userMessage,
  tools,
  executeTools,
  onProgress = () => {},
}) {
  const messages = [{ role: "user", content: userMessage }];
  let round = 0;

  while (true) {
    round++;
    onProgress({ type: "api_call", round });

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages,
    });

    onProgress({ type: "stop_reason", value: response.stop_reason, round });

    // Append Claude's reply to history
    messages.push({ role: "assistant", content: response.content });

    // ── Done ──────────────────────────────────────────────────────────────
    if (response.stop_reason === "end_turn") {
      const finalText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      onProgress({ type: "complete", text: finalText });
      return finalText;
    }

    // ── Tool calls ────────────────────────────────────────────────────────
    if (response.stop_reason === "tool_use") {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        onProgress({ type: "tool_call", tool: block.name, input: block.input });

        const output = executeTools(block.name, block.input);

        onProgress({ type: "tool_result", tool: block.name, output });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(output),
        });
      }

      // Send results back and loop
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // ── Unexpected ────────────────────────────────────────────────────────
    throw new Error(
      `Unexpected stop_reason "${response.stop_reason}" in round ${round}`
    );
  }
}
