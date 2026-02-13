import { down } from "./down";
import { up } from "./up";
import { log } from "../lib/log";

/**
 * `boot reboot` — stop then start all services.
 */
export async function reboot(): Promise<void> {
  log.info("Rebooting...");
  await down();
  await up();
}
