import { AIProvider, AISummaryInput, AISummaryOutput } from "./baseProvider";

/**
 * OpenAI provider for AI-generated summaries.
 * Requires OPENAI_API_KEY environment variable.
 * Uses chat completions with a structured prompt — no streaming, minimal tokens.
 * Falls back gracefully if the key is missing or the call fails.
 */
export class OpenAIProvider implements AIProvider {
  name = "openai";

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async summarize(input: AISummaryInput): Promise<AISummaryOutput> {
    if (!this.isConfigured()) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const prompt = buildPrompt(input);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a developer assistant. Summarize AI coding sessions concisely. " +
              "Respond with valid JSON only. No markdown, no explanation.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as any;
    const text = json.choices?.[0]?.message?.content ?? "{}";

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
      throw new Error("Failed to parse OpenAI response as JSON");
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
