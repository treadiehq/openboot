#!/usr/bin/env node

import { Command } from "commander";
import { init } from "./commands/init";
import { setup } from "./commands/setup";
import { up } from "./commands/up";
import { down } from "./commands/down";
import { reboot } from "./commands/reboot";
import { status } from "./commands/status";
import { clean } from "./commands/clean";
import { logs } from "./commands/logs";
import { dev } from "./commands/dev";
import { registerAgentCommands } from "./commands/agent";
import { version, update, getCurrentVersion } from "./commands/update";

const program = new Command();

program
  .name("boot")
  .description("Dev stack lifecycle manager. One command to setup, start, stop, and reboot your projects.")
  .version(getCurrentVersion(), "-V, --version", "Output the version number");

program
  .command("init")
  .description("Auto-detect project structure and create boot.yaml")
  .action(async () => {
    try {
      await init();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("setup")
  .description("Run one-time setup (install deps, start DB, run migrations)")
  .action(async () => {
    try {
      await setup();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("up")
  .description("Start all services (Docker + apps)")
  .option("-a, --attach", "Attach to logs after starting (Ctrl+C detaches, services keep running)")
  .action(async (opts) => {
    try {
      await up(opts);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("dev")
  .description("Start all services with live logs (Ctrl+C stops everything)")
  .action(async () => {
    try {
      await dev();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("down")
  .description("Stop all services")
  .action(async () => {
    try {
      await down();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("reboot")
  .description("Restart all services (down + up)")
  .action(async () => {
    try {
      await reboot();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show status of all services")
  .action(async () => {
    try {
      await status();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("logs [service]")
  .description("View logs for services (boot logs api -f)")
  .option("-f, --follow", "Follow log output (like tail -f)")
  .option("-n, --lines <count>", "Number of lines to show (default: 40)")
  .action(async (service, opts) => {
    try {
      await logs(service, opts);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("clean")
  .description("Remove node_modules, caches, and build outputs for a fresh start")
  .option("--all", "Also remove pnpm-lock.yaml")
  .action(async (opts) => {
    try {
      await clean(opts);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("version")
  .description("Show current version and check for updates")
  .action(async () => {
    try {
      await version();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("update")
  .description("Update openboot to the latest version")
  .action(async () => {
    try {
      await update();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

registerAgentCommands(program);

program.parse();
