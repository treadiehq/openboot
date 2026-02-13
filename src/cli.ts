#!/usr/bin/env node

import { Command } from "commander";
import { init } from "./commands/init";
import { setup } from "./commands/setup";
import { up } from "./commands/up";
import { down } from "./commands/down";
import { reboot } from "./commands/reboot";
import { status } from "./commands/status";

const program = new Command();

program
  .name("boot")
  .description("Dev stack lifecycle manager. One command to setup, start, stop, and reboot your projects.")
  .version("0.1.0");

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
  .action(async () => {
    try {
      await up();
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

program.parse();
