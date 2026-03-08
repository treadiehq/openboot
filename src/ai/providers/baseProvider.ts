export interface AISummaryInput {
  task?: string;
  filesChanged?: string[];
  commandsRun?: string[];
  messageExcerpts?: string[];
  eventTypes?: string[];
}

export interface AISummaryOutput {
  task: string;
  filesChanged: string[];
  decisions: string[];
  nextSteps: string[];
  summary: string;
}

/**
 * All AI provider adapters implement this interface.
 * The system always falls back to the deterministic summarizer
 * if no provider is configured or if the provider call fails.
 */
export interface AIProvider {
  name: string;
  isConfigured(): boolean;
  summarize(input: AISummaryInput): Promise<AISummaryOutput>;
}
