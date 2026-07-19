import { ChatbotConfig, Config, Execute } from "@/types";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import TelegramBot, {
  CallbackQuery,
  InlineKeyboardMarkup,
} from "node-telegram-bot-api";
import { getPrefix } from "@/utils/getPrefix";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// This file already lives in src/commands, so the commands directory is
// just __dirname — no need to walk up from a sibling folder like
// utils/handlecmd.ts used to.
const COMMANDS_DIR = __dirname;

const HELP_PAGE_SIZE = 10;

export const config: Config = {
  name: "help",
  description:
    "Shows the command list, or detailed info about a specific command.",
  usage: "/help [command | page]",
  permission: "user",
  creator: "itsunknown",
};

// Falls back to the command's own name (e.g. "/example") whenever its
// usage is empty/unset, so the help list/detail views never render a
// blank usage line — this is computed dynamically here rather than
// hardcoded per-command, and respects whatever prefix is configured.
function formatUsage(usage: string, name: string, prefix: string) {
  const trimmed = String(usage ?? "").trim();
  return trimmed.length > 0 ? trimmed : `${prefix}${name}`;
}

type CommandEntry = { config: Config };

// Scans every file in src/commands (this file included) so <prefix>help
// lists itself alongside every other command without any manual patching.
async function loadCommands(): Promise<CommandEntry[]> {
  const commandFiles = fs
    .readdirSync(COMMANDS_DIR)
    .filter((file) => file.endsWith(path.extname(import.meta.filename)));

  const commands = await Promise.all(
    commandFiles.map(async (file) => {
      const mod = await import(
        pathToFileURL(path.join(COMMANDS_DIR, file)).href
      );
      return { config: mod.config as Config };
    }),
  );

  return commands
    .filter((cmd) => cmd?.config?.name)
    .sort((a, b) => a.config.name.localeCompare(b.config.name));
}

function buildPaginationKeyboard(
  page: number,
  totalPages: number,
): InlineKeyboardMarkup {
  const row: { text: string; callback_data: string }[] = [];

  if (page > 1) {
    row.push({ text: "◀️ Prev", callback_data: `help_page_${page - 1}` });
  }

  row.push({ text: `📄 ${page}/${totalPages}`, callback_data: "help_noop" });

  if (page < totalPages) {
    row.push({ text: "Next ▶️", callback_data: `help_page_${page + 1}` });
  }

  return { inline_keyboard: [row] };
}

function buildListView(
  allCommands: CommandEntry[],
  isAdmin: boolean,
  requestedPage: number,
  prefix: string,
) {
  const visibleCommands = allCommands.filter(
    (cmd) => cmd.config.permission === "user" || isAdmin,
  );

  const totalPages = Math.max(
    1,
    Math.ceil(visibleCommands.length / HELP_PAGE_SIZE),
  );
  const page = Math.min(Math.max(requestedPage || 1, 1), totalPages);
  const start = (page - 1) * HELP_PAGE_SIZE;
  const pageCommands = visibleCommands.slice(start, start + HELP_PAGE_SIZE);

  if (visibleCommands.length === 0) {
    return {
      text: "⚠️ No commands are currently available.",
      keyboard: undefined as InlineKeyboardMarkup | undefined,
      page,
      totalPages,
    };
  }

  const lines = pageCommands.map((cmd) => {
    const marker = cmd.config.permission === "admin" ? "▪️" : "▫️";
    return (
      `${marker} ${prefix}${cmd.config.name}\n` +
      `     _Description:_ ${cmd.config.description}\n` +
      `     _Usage:_ \`${formatUsage(cmd.config.usage, cmd.config.name, prefix)}\``
    );
  });

  const text =
    `🤖 *Command Menu*\n` +
    `─────────────────\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `─────────────────\n` +
    `💡 Type \`${prefix}help [command]\` to see the info of commands.\n` +
    `📑 Type \`${prefix}help [page]\` to go to a page.\n` +
    `📦 ${visibleCommands.length} command${visibleCommands.length === 1 ? "" : "s"} available` +
    `${isAdmin ? " · admin_view" : ""} · page ${page}/${totalPages}`;

  const keyboard =
    totalPages > 1 ? buildPaginationKeyboard(page, totalPages) : undefined;

  return { text, keyboard, page, totalPages };
}

function buildDetailView(found: CommandEntry, prefix: string) {
  const { name, description, usage, permission, creator } = found.config;
  const admin_only = permission === "admin" ? "admin" : "user";

  return (
    `📖 *Command Details*\n` +
    `─────────────────\n\n` +
    `🔹 *Name:* ${prefix}${name}\n` +
    `🔹 *Permission:* ${admin_only}\n` +
    `🔹 *Author:* ${creator}\n\n` +
    `📝 *Description:*\n${description}\n\n` +
    `⚙️ *Usage:*\n\`${formatUsage(usage, name, prefix)}\``
  );
}

export async function execute({ api, event, args, chatbotConfig }: Execute) {
  try {
    const prefix = getPrefix(chatbotConfig);
    const isAdmin =
      !!event.from && chatbotConfig.admins.includes(event.from.id);
    const allCommands = await loadCommands();

    const query = args[0]?.toLowerCase();
    const isPageRequest = !!query && /^\d+$/.test(query);

    // ── Detail view: <prefix>help <command> ─────────────────────────
    if (query && !isPageRequest) {
      const found = allCommands.find(
        (cmd) => cmd.config.name.toLowerCase() === query,
      );

      if (!found) {
        await api.sendMessage(
          event.chat.id,
          `🚫 *Command Not Found!*\n\n` +
            `\`${query}\` doesn't exist.\n` +
            `Send \`${prefix}help\` to see the full command list.`,
        );
        return false;
      }

      if (found.config.permission === "admin" && !isAdmin) {
        await api.sendMessage(
          event.chat.id,
          `🔒 *Locked Command!*\n\n` +
            `You don't have permission to view \`${found.config.name}\` commands.`,
        );
        return false;
      }

      return api.sendMessage(event.chat.id, buildDetailView(found, prefix));
    }

    // ── List view: <prefix>help [page] ───────────────────────────────
    const requestedPage = isPageRequest ? parseInt(query!, 10) : 1;
    const { text, keyboard } = buildListView(
      allCommands,
      isAdmin,
      requestedPage,
      prefix,
    );

    return api.sendMessage(event.chat.id, text, {
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  } catch (error: any) {
    api.sendMessage(
      event.chat.id,
      "❌ Failed to load help menu: " + error.message,
    );
    console.error("help command error:", error?.message ?? error);
    return false;
  }
}

// Handles inline keyboard interactions for help pagination. Called from
// handlecmd.ts's callback_query listener, since callback queries aren't
// routed through the normal command dispatcher.
export async function handleHelpCallback(
  bot: TelegramBot,
  query: CallbackQuery,
  chatbotConfig: ChatbotConfig,
) {
  const data = query.data as string;

  if (data === "help_noop") {
    return bot.answerCallbackQuery(query.id).catch(() => {});
  }

  const match = data.match(/^help_page_(\d+)$/);
  if (!match) {
    return bot.answerCallbackQuery(query.id).catch(() => {});
  }

  try {
    const prefix = getPrefix(chatbotConfig);
    const requestedPage = parseInt(match[1], 10);
    const isAdmin =
      !!query.from && chatbotConfig.admins.includes(query.from.id);
    const allCommands = await loadCommands();
    const { text, keyboard } = buildListView(
      allCommands,
      isAdmin,
      requestedPage,
      prefix,
    );

    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;

    if (chatId && messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
    }

    await bot.answerCallbackQuery(query.id).catch(() => {});
  } catch (error: any) {
    console.error("help pagination error:", error?.message ?? error);
    await bot
      .answerCallbackQuery(query.id, { text: "Failed to change page." })
      .catch(() => {});
  }
}
