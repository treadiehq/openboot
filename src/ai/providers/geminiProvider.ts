import { AIProvider, AISummaryInput, AISummaryOutput } from "./baseProvider";

/**
 * Google Gemini provider for AI-generated summaries.
 * Requires GEMINI_API_KEY environment variable.
 * Uses gemini-2.0-flash for fast, low-cost summarization.
 */
export class GeminiProvider implements AIProvider {
  name = "gemini";

  isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  async summarize(input: AISummaryInput): Promise<AISummaryOutput> {
    if (!this.isConfigured()) {
      throw new Error("GEMINI_API_KEY not set");
    }

    const prompt = buildPrompt(input);
    const key = process.env.GEMINI_API_KEY!;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 400,
          responseMimeType: "application/json",
        },
        systemInstruction: {
          parts: [
            {
              text:
                "You are a developer assistant. Summarize AI coding sessions concisely. " +
                "Respond with valid JSON only. No markdown fences, no explanation outside the JSON.",
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as any;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    // Strip markdown fences if the model wraps output despite instructions
    const clean = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    try {
      const parsed = JSON.parse(clean) as Partial<AISummaryOutput>;
      return {
        task: parsed.task ?? input.task ?? "Unknown task",
        filesChanged: parsed.filesChanged ?? input.filesChanged ?? [],
        decisions: parsed.decisions ?? [],
        nextSteps: parsed.nextSteps ?? [],
        summary: parsed.summary ?? "",
      };
    } catch {
      throw new Error("Failed to parse Gemini response as JSON");
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
