/**
 * BotManager — runs every dashboard user's Telegram bot as its own
 * node-telegram-bot-api polling instance, all inside this one Node
 * process (chosen over one-process-per-token for lower resource use on a
 * single PaaS dyno). Adding/removing a token in the web dashboard calls
 * start()/stop() directly — no restart of the shared process required.
 *
 * Each instance gets its own ChatbotConfig (prefix, botname, admins,
 * developerMode) loaded from bot_instance_settings, so tenants don't share
 * runtime state even though they share a process.
 */
import chalk from "chalk";
import TelegramBot from "node-telegram-bot-api";
import { wrapBot } from "@/utils/wrapper";
import { handleCommands } from "@/utils/handleCommands";
import { handleEvents } from "@/utils/handleEvents";
import { chatbotConfig as defaultConfig } from "@/config";
import {
  BotInstance,
  getInstanceSetting,
  listEnabledBotInstances,
  setBotInstanceStatus,
} from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { ChatbotConfig } from "@/types";

type RunningBot = {
  bot: TelegramBot;
  chatbotConfig: ChatbotConfig;
};

class BotManager {
  private running = new Map<number, RunningBot>();

  isRunning(instanceId: number): boolean {
    return this.running.has(instanceId);
  }

  /** Called once at process boot: starts every instance the DB says should be enabled. */
  async loadAll(): Promise<void> {
    const instances = await listEnabledBotInstances();
    console.log(
      chalk.cyan.bold(`[BotManager] Starting ${instances.length} enabled bot instance(s)...`),
    );
    // Sequential on purpose: staggers Telegram API calls (getMe, setup)
    // across many tenants at once instead of a startup thundering herd.
    for (const instance of instances) {
      await this.start(instance).catch((error) => {
        console.error(`[BotManager] Failed to start instance ${instance.id}:`, error);
      });
    }
  }

  /**
   * Starts (or restarts, if already running) polling for one instance.
   * Persists the resulting status/error back to bot_instances so the
   * dashboard reflects reality.
   */
  async start(instance: BotInstance): Promise<void> {
    await this.stop(instance.id);

    let token: string;
    try {
      token = decryptSecret({
        ciphertext: instance.token_ciphertext,
        iv: instance.token_iv,
        tag: instance.token_tag,
      });
    } catch (error) {
      const message = "Failed to decrypt stored token (was ENCRYPTION_KEY changed?)";
      console.error(`[BotManager] Instance ${instance.id}:`, error);
      await setBotInstanceStatus(instance.id, "error", message);
      return;
    }

    await setBotInstanceStatus(instance.id, "starting");

    const bot = new TelegramBot(token, { polling: true });

    let me: TelegramBot.User;
    try {
      me = await bot.getMe();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[BotManager] Instance ${instance.id} invalid token:`, message);
      try {
        await bot.stopPolling();
      } catch {
        // already dead, nothing to clean up
      }
      await setBotInstanceStatus(instance.id, "error", `Invalid token: ${message}`);
      return;
    }

    const chatbotConfig = await buildInstanceConfig(instance.id);
    const wrappedBot = wrapBot(bot);

    bot.on("polling_error", (error) => {
      console.error(`[BotManager] Instance ${instance.id} polling error:`, error.message);
    });

    await handleCommands(wrappedBot, chatbotConfig);
    await handleEvents(wrappedBot, chatbotConfig);

    this.running.set(instance.id, { bot, chatbotConfig });
    await setBotInstanceStatus(instance.id, "running", null, me.username ?? null);
    console.log(
      chalk.cyan.bold(`[BotManager] Instance ${instance.id} running as @${me.username}`),
    );
  }

  async stop(instanceId: number): Promise<void> {
    const existing = this.running.get(instanceId);
    if (!existing) return;
    this.running.delete(instanceId);
    try {
      await existing.bot.stopPolling();
    } catch (error) {
      console.error(`[BotManager] Error stopping instance ${instanceId}:`, error);
    }
    await setBotInstanceStatus(instanceId, "stopped");
  }

  /** Used by the /restart command — restarts just this tenant's bot, not the shared process. */
  async restart(instance: BotInstance): Promise<void> {
    await this.start(instance);
  }
}

async function buildInstanceConfig(instanceId: number): Promise<ChatbotConfig> {
  const [prefix, botname, developerModeRaw, adminsRaw] = await Promise.all([
    getInstanceSetting(instanceId, "prefix"),
    getInstanceSetting(instanceId, "botname"),
    getInstanceSetting(instanceId, "developer_mode"),
    getInstanceSetting(instanceId, "admins"),
  ]);

  const admins = adminsRaw
    ? adminsRaw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : [];

  return {
    admins,
    prefix: prefix || defaultConfig.prefix,
    botname: botname || defaultConfig.botname,
    developerMode: developerModeRaw === "true",
    instanceId,
  };
}

export const botManager = new BotManager();
