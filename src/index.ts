import chalk from "chalk";
import { createWebApp } from "@/web/app";
import { botManager } from "@/bot/manager";

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  // Starts every dashboard-enabled bot's polling connection. Each bot's
  // commands/events are wired up inside botManager.start() (see
  // src/bot/manager.ts) — there's no single global `bot` anymore.
  await botManager.loadAll();

  const app = createWebApp();
  app.listen(PORT, () => {
    console.log(chalk.cyan.bold(`[SYSTEM]: Web dashboard listening on port ${PORT}`));
  });
}

main().catch((error) => {
  console.error(chalk.red.bold("[SYSTEM]: Fatal startup error:"), error);
  process.exit(1);
});
