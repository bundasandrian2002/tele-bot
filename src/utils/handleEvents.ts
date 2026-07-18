import { ChatbotConfig, EventConfig, EventExecute } from "@/types";
import TelegramBot, { Message } from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { getPrefix } from "@/utils/getPrefix";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type LoadedEvent = {
  config: EventConfig;
  execute: (ctx: EventExecute) => Promise<any>;
};

/**
 * Registers every event under src/app/events automatically — no manual
 * bot.on(...) wiring needed here. Each event file declares which
 * node-telegram-bot-api event it listens on via `config.trigger`; this
 * scans the directory (same pattern used for commands),
 * loads every file's config/execute, and groups them by trigger so that
 * adding a brand-new event just means dropping a new file in
 * src/app/events — this file never needs to change again.
 */
export const handleEvents = async (
  bot: TelegramBot,
  chatbotConfig: ChatbotConfig,
) => {
  const events = await loadEvents();

  const eventsByTrigger = new Map<string, LoadedEvent[]>();
  for (const loaded of events) {
    const trigger = loaded.config.trigger;
    if (!eventsByTrigger.has(trigger)) {
      eventsByTrigger.set(trigger, []);
    }
    eventsByTrigger.get(trigger)!.push(loaded);
  }

  for (const [trigger, loadedEvents] of eventsByTrigger) {
    // Multiple event files can share one trigger (e.g. several
    // "message" watchers) — they're all fanned out from a single
    // bot.on(...) listener per trigger name.
    bot.on(trigger as any, async (payload: Message) => {
      for (const loaded of loadedEvents) {
        await runEvent(loaded, bot, payload, chatbotConfig);
      }
    });
  }
};

const loadEvents = async (): Promise<LoadedEvent[]> => {
  const eventsDir = path.join(__dirname, "../events");
  const eventFiles = fs
    .readdirSync(eventsDir)
    .filter((file) => file.endsWith(path.extname(import.meta.filename)));

  const loaded: LoadedEvent[] = [];

  for (const file of eventFiles) {
    try {
      const mod: {
        execute?: (ctx: EventExecute) => Promise<any>;
        config?: EventConfig;
      } = await import(pathToFileURL(path.join(eventsDir, file)).href);

      const { execute, config } = mod;

      if (!config) {
        console.error(`Event file '${file}' is missing a config.`);
        continue;
      }

      if (!execute) {
        console.error(`Event '${config.name}' is missing an execute function.`);
        continue;
      }

      if (!config.trigger) {
        console.error(`Event '${config.name}' is missing a 'trigger'.`);
        continue;
      }

      loaded.push({ config, execute });
    } catch (error) {
      console.error(`Error loading event file '${file}':`, error);
    }
  }

  return loaded;
};

const runEvent = async (
  loaded: LoadedEvent,
  bot: TelegramBot,
  message: Message,
  chatbotConfig: ChatbotConfig,
) => {
  const { config, execute } = loaded;

  // Events that opt into skipCommandPrefix (only meaningful on the
  // "message" trigger) are passive watchers running alongside
  // handleCommands.ts's own "message" listener — skip anything that's
  // actually a prefixed command so it isn't handled twice.
  if (config.skipCommandPrefix) {
    const text = message.text?.trim();
    if (!text) return;

    const prefix = getPrefix(chatbotConfig);
    if (text.startsWith(prefix)) return;
  }

  try {
    await execute({ api: bot, event: message, chatbotConfig });
  } catch (error) {
    console.error(`Error executing '${config.name}' event:`, error);
  }
};
