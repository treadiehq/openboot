import { AIProvider, AISummaryInput, AISummaryOutput } from "./baseProvider";

/**
 * Anthropic Claude provider for AI-generated summaries.
 * Requires ANTHROPIC_API_KEY environment variable.
 * Uses the Messages API with claude-haiku-3-5 for fast, cheap summarization.
 */
export class ClaudeProvider implements AIProvider {
  name = "claude";

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async summarize(input: AISummaryInput): Promise<AISummaryOutput> {
    if (!this.isConfigured()) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }

    const prompt = buildPrompt(input);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system:
          "You are a developer assistant. Summarize AI coding sessions concisely. " +
          "Respond with valid JSON only. No markdown fences, no explanation outside the JSON.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as any;
    const text = json.content?.[0]?.text ?? "{}";

    try {
      const parsed = JSON.parse(text) as Partial<AISummaryOutput>;
      return {
        task: parsed.task ?? input.task ?? "Unknown task",
        filesChanged: parsed.filesChanged ?? input.filesChanged ?? [],
        decisions: parsed.decisions ?? [],
        nextSteps: parsed.nextSteps ?? [],
        summary: parsed.summary ?? "",
      };
    } catch {
      throw new Error("Failed to parse Claude response as JSON");
    }
  }
}

function buildPrompt(input: AISummaryInput): string {
  const parts: string[] = [
    `Summarize this AI coding session. Return JSON with keys: task, filesChanged (string[]), decisions (string[]), nextSteps (string[]), summary (string).`,
    "",
  ];
  if (input.task) parts.push(`Task: ${input.task}`);
  if (input.filesChanged?.length) parts.push(`Files changed: ${input.filesChanged.join(", ")}`);
  if (input.commandsRun?.length) parts.push(`Commands run: ${input.commandsRun.join(", ")}`);
  if (input.eventTypes?.length) parts.push(`Activity types: ${input.eventTypes.join(", ")}`);
  if (input.messageExcerpts?.length) {
    parts.push(`Recent prompts:`);
    for (const m of input.messageExcerpts.slice(0, 3)) parts.push(`  - ${m.slice(0, 100)}`);
  }
  return parts.join("\n");
}
