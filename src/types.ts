export interface BootConfig {
  /** Project name */
  name: string;

  /** Package manager override (auto-detected if omitted) */
  packageManager?: "pnpm" | "npm" | "yarn";

  /** Environment file validation */
  env?: EnvConfig;

  /** One-time setup commands (run via `boot setup`) */
  setup?: string[];

  /** Docker services (compose-based or raw containers) */
  docker?: DockerConfig;

  /** Application processes managed by boot */
  apps?: AppConfig[];

  /** AI agent context configuration */
  agent?: AgentConfig;

  /** Team / company profile — shared config synced from a git repo */
  team?: TeamConfig;
}

export interface TeamConfig {
  /** Git URL of the team profile repo (SSH or HTTPS) */
  url: string;

  /** If true, Boot refuses to run commands when the team profile can't be resolved */
  required?: boolean;

  /** Branch to track (default: main) */
  branch?: string;
}

export interface AgentConfig {
  /** Project description for AI context */
  description?: string;

  /** Coding conventions for this project */
  conventions?: string[];

  /** Target files to sync agent context to */
  targets?: string[];

  /**
   * Git repos to clone and include as reference context for AI agents.
   * Supports short form (just a URL string) or long form (object with include paths).
   */
  references?: ReferenceEntry[];
}

/** A reference can be a plain URL string or an object with include paths */
export type ReferenceEntry = string | ReferenceConfig;

export interface ReferenceConfig {
  /** Git URL (SSH or HTTPS) */
  url: string;

  /** Paths to include from the repo (globs or directories). If omitted, includes the README. */
  include?: string[];
}

export interface EnvConfig {
  /** Path to .env file (default: .env) */
  file?: string;

  /** Required environment variables — boot up will fail if these are missing */
  required?: string[];

  /** Values that should be rejected (e.g. example/default secrets) */
  reject?: Record<string, string[]>;
}

export interface DockerConfig {
  /** Path to compose file (default: docker-compose.yml) */
  composeFile?: string;

  /** Services managed via docker compose (requires composeFile) */
  services?: DockerService[];

  /** Standalone containers managed via docker run/start (no compose needed) */
  containers?: ContainerConfig[];
}

export interface DockerService {
  /** Service name (used for display) */
  name: string;

  /** Container name (for docker exec; defaults to name) */
  container?: string;

  /** Command to run inside container to check readiness */
  readyCheck?: string;

  /** Seconds to wait for readiness (default: 30) */
  timeout?: number;
}

export interface ContainerConfig {
  /** Container name */
  name: string;

  /** Docker image */
  image: string;

  /** Port mappings (e.g. "5433:5432") */
  ports?: string[];

  /** Environment variables for the container */
  env?: Record<string, string>;

  /** Volume mounts */
  volumes?: string[];

  /** Command to run inside container to check readiness */
  readyCheck?: string;

  /** Seconds to wait for readiness (default: 30) */
  timeout?: number;
}

export interface AppConfig {
  /** App name (used for display, PID files, log files) */
  name: string;

  /** Working directory relative to project root */
  path?: string;

  /** Command to start the app */
  command: string;

  /** Port the app listens on */
  port?: number;

  /** URL to poll for health check */
  health?: string;

  /** Extra environment variables */
  env?: Record<string, string>;
}
