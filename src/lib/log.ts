const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export const log = {
  info(msg: string) {
    console.log(`${BLUE}▶${RESET} ${msg}`);
  },

  success(msg: string) {
    console.log(`${GREEN}✓${RESET} ${msg}`);
  },

  warn(msg: string) {
    console.log(`${YELLOW}⚠${RESET} ${msg}`);
  },

  error(msg: string) {
    console.error(`${RED}✗${RESET} ${msg}`);
  },

  header(title: string) {
    console.log("");
    console.log(
      `${CYAN}╔${"═".repeat(title.length + 4)}╗${RESET}`
    );
    console.log(`${CYAN}║${RESET}  ${BOLD}${title}${RESET}  ${CYAN}║${RESET}`);
    console.log(
      `${CYAN}╚${"═".repeat(title.length + 4)}╝${RESET}`
    );
    console.log("");
  },

  step(msg: string) {
    console.log(`  ${DIM}${msg}${RESET}`);
  },

  blank() {
    console.log("");
  },

  table(rows: string[][]) {
    if (rows.length === 0) return;

    // Calculate column widths
    const colWidths = rows[0].map((_, i) =>
      Math.max(...rows.map((r) => (r[i] || "").length))
    );

    for (const row of rows) {
      const line = row
        .map((cell, i) => cell.padEnd(colWidths[i]))
        .join("   ");
      console.log(`  ${line}`);
    }
  },
};
