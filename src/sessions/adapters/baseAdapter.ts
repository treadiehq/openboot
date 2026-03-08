import { Session } from "../sessionStore";

export interface DiscoveredSession {
  /** Human-readable label for display */
  label: string;
  /** Absolute path to the source file */
  sourcePath: string;
  /** Raw parsed content — adapter-specific shape */
  raw: unknown;
}

/**
 * All source adapters implement this interface.
 * Methods should never throw — return empty arrays on failure.
 */
export interface SessionAdapter {
  /** Canonical name of this source (matches session.source.name) */
  name: string;
  /** Human-readable display label */
  displayName: string;
  /** Return candidate paths this adapter will search */
  detectPaths(): Promise<string[]>;
  /** Scan the given paths and return discovered raw sessions */
  discoverSessions(paths: string[]): Promise<DiscoveredSession[]>;
  /** Normalize a discovered session into the OpenBoot session schema */
  importSession(input: DiscoveredSession): Promise<Omit<Session, "id" | "createdAt" | "updatedAt"> | null>;
}
