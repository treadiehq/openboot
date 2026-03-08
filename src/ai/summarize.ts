import { Session } from "../sessions/sessionStore";
import { Task } from "../tasks/taskStore";
import { buildSessionSummary } from "../summaries/buildSummary";
import { AIProvider, AISummaryInput, AISummaryOutput } from "./providers/baseProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import { ClaudeProvider } from "./providers/claudeProvider";
import { GeminiProvider } from "./providers/geminiProvider";

/**
 * Provider priority: first configured provider wins.
 * Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY to enable the matching provider.
 * If none are set, the deterministic fallback is used automatically.
 */
const PROVIDERS: AIProvider[] = [
  new OpenAIProvider(),
  new ClaudeProvider(),
  new GeminiProvider(),
];

function getConfiguredProvider(): AIProvider | null {
  return PROVIDERS.find((p) => p.isConfigured()) ?? null;
}

/**
 * Build an AISummaryInput from a Session.
 * Shared between AI providers and the deterministic fallback.
 */
export function sessionToSummaryInput(session: Session): AISummaryInput {
  return {
    task: session.task,
    filesChanged: session.metadata.filesTouched ?? [],
    commandsRun: session.metadata.commandsRun ?? [],
    eventTypes: [...new Set((session.events ?? []).map((e) => e.type))],
    messageExcerpts: (session.messages ?? [])
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => m.content),
  };
}

/**
 * Build an AISummaryInput from a Task.
 */
export function taskToSummaryInput(task: Task): AISummaryInput {
  return {
    task: task.title,
    filesChanged: [],
    commandsRun: [],
    eventTypes: [],
    messageExcerpts: [task.description].filter(Boolean),
  };
}

/**
 * Deterministic fallback — never requires network.
 */
function deterministicSummary(input: AISummaryInput): AISummaryOutput {
  const parts: string[] = [];
  if (input.task) parts.push(`Task: ${input.task}`);
  if (input.filesChanged?.length) parts.push(`Files: ${input.filesChanged.slice(0, 3).join(", ")}`);
  if (input.commandsRun?.length) parts.push(`Commands: ${input.commandsRun.slice(0, 2).join(", ")}`);

  return {
    task: input.task ?? "Unknown task",
    filesChanged: input.filesChanged ?? [],
    decisions: [],
    nextSteps: [],
    summary: parts.join(" · ") || "No activity recorded",
  };
}

export interface SummarizeResult {
  output: AISummaryOutput;
  usedProvider: string;
}

/**
 * Summarize a session — uses AI provider if configured, falls back to deterministic.
 */
export async function summarizeSession(session: Session): Promise<SummarizeResult> {
  const input = sessionToSummaryInput(session);
  const provider = getConfiguredProvider();

  if (provider) {
    try {
      const output = await provider.summarize(input);
      return { output, usedProvider: provider.name };
    } catch {
      // Fall through to deterministic
    }
  }

  return { output: deterministicSummary(input), usedProvider: "deterministic" };
}

/**
 * Summarize a task — uses AI provider if configured, falls back to deterministic.
 */
export async function summarizeTask(task: Task): Promise<SummarizeResult> {
  const input = taskToSummaryInput(task);
  const provider = getConfiguredProvider();

  if (provider) {
    try {
      const output = await provider.summarize(input);
      return { output, usedProvider: provider.name };
    } catch {
      // Fall through to deterministic
    }
  }

  return { output: deterministicSummary(input), usedProvider: "deterministic" };
}
