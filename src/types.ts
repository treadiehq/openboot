export interface BootConfig {
  /** Project name */
  name: string;

  /** Package manager override (auto-detected if omitted) */
  packageManager?: "pnpm" | "npm" | "yarn";

  /** One-time setup commands (run via `boot setup`) */
  setup?: string[];

  /** Docker services managed via docker compose */
  docker?: DockerConfig;

  /** Application processes managed by boot */
  apps?: AppConfig[];
}

export interface DockerConfig {
  /** Path to compose file (default: docker-compose.yml) */
  composeFile?: string;

  /** Services to wait for after starting */
  services?: DockerService[];
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
