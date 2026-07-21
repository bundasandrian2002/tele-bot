import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import Groq from "groq-sdk";
import TelegramBot, { Message } from "node-telegram-bot-api";
import { AgentTool, ChatbotConfig, Config } from "@/types";
import { getPrefix } from "@/utils/getPrefix";
import { forwardCalls, takeCalls } from "@/agent/lib/commandResultStore";
import { startTypingIndicator } from "@/utils/typingIndicator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Groq model id — "by default" per spec, but still overridable via env
// for anyone who wants a different Groq-hosted model without touching code.
// const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const DEFAULT_MODEL = process.env.GROQ_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free";

// Loaded once at module evaluation time — same approach as index.ts's
// startup logs, so a missing/malformed file fails fast instead of on the
// first /ai invocation.
const SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../agent/system_prompt.md"),
  "utf-8",
);

let cachedTools: AgentTool[] | null = null;

/**
 * Dynamically loads every tool under src/agent/tools — dropping a new file
 * there is enough to expose it to the agent, mirroring how commands and
 * events are already auto-discovered elsewhere in this bot.
 */
export async function loadAgentTools(): Promise<AgentTool[]> {
  if (cachedTools) return cachedTools;

  const tools: AgentTool[] = [];
  const dir = path.join(__dirname, "../agent/tools");

  if (!fs.existsSync(dir)) {
    cachedTools = [];
    return cachedTools;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(path.extname(import.meta.filename)));

  for (const file of files) {
    try {
      const mod = (await import(
        pathToFileURL(path.join(dir, file)).href
      )) as AgentTool;

      if (mod.config && typeof mod.run === "function") {
        tools.push(mod);
      }
    } catch (err) {
      console.error(`[Agent] Failed to load tool ${file}`, err);
    }
  }

  cachedTools = tools;
  return cachedTools;
}

/**
 * Builds the "name (permission) — description" list injected into the
 * system prompt, so the model knows what test_command can invoke without
 * needing a help() round-trip for every command.
 */
async function listAvailableCommands(): Promise<string> {
  const dir = path.join(__dirname, "../commands");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(path.extname(import.meta.filename)));

  const lines: string[] = [];
  for (const file of files) {
    try {
      const mod = (await import(pathToFileURL(path.join(dir, file)).href)) as {
        config?: Config;
      };
      if (mod.config?.name) {
        lines.push(
          `${mod.config.name} (${mod.config.permission}) — ${mod.config.description}`,
        );
      }
    } catch {
      // A single broken command file shouldn't take down the agent's
      // ability to list everything else.
    }
  }

  return lines.sort().join("\n");
}

// Some tool-use models occasionally emit the send_result call as plain
// JSON text (e.g. {"message": "...", "attachment_keys": [...]}) instead of
// an actual tool call. When that happens, pull out just the `message`
// field so the raw JSON blob never reaches the user — any keys it
// referenced are still forwarded separately via pendingMediaKeys, which is
// populated from the real test_command tool calls regardless of how
// send_result ends up being expressed.
function extractReplyText(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{")) return rawText;

  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.message === "string"
    ) {
      return parsed.message;
    }
  } catch {
    // Not JSON — an ordinary conversational reply, leave it as-is.
  }

  return rawText;
}

// =========================
// 🚀 AGENT LOOP ENGINE
// =========================
/**
 * Runs the ReAct-style agent loop, resolving tool calls recursively until
 * send_result delivers a reply or the turn limit is reached.
 */
export async function runAgent(
  userInput: string,
  bot: TelegramBot,
  message: Message,
  chatbotConfig: ChatbotConfig,
  userContext?: string,
): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error(
      "GROQ_API_KEY environment variable is not set. AI capabilities are disabled.",
    );
  }

  const groq = new Groq({ apiKey: groqApiKey });
  const tools = await loadAgentTools();

  const chatTools = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.config.name,
      description: t.config.description,
      parameters: t.config.parameters,
    },
  }));

  const isAdmin = chatbotConfig.admins.includes(message.from?.id ?? -1);
  const userRoleLabel = isAdmin ? "Bot Administrator" : "Regular User";
  const userName = message.from?.first_name || "User";
  // Needed (alongside userName) to build a tg://user?id= mention link in the
  // system prompt — a text mention works even for users with no @username,
  // unlike a bare @handle. Same -1 sentinel as isAdmin above; user-sent
  // messages always carry `from`, so this only guards the type.
  const userId = message.from?.id ?? -1;
  // Always identify the agent by the bot's real Telegram first name — no
  // hardcoded/config-driven nickname involved. chatbotConfig.nickname is
  // only a trigger word for the passive nickname event, not the bot's
  // identity, so it's intentionally not used here.
  const botName = await bot
    .getMe()
    .then((me) => me.first_name)
    .catch(() => "Bot");
  const availableCommands = await listAvailableCommands();

  const systemContent = SYSTEM_PROMPT_TEMPLATE.replace(
    "{{BOT_NAME}}",
    botName || "Bot",
  )
    .replace(/{{USER_NAME}}/g, userName)
    .replace(/{{USER_ID}}/g, String(userId))
    .replace("{{COMMAND_PREFIX}}", getPrefix(chatbotConfig))
    .replace("{{USER_ROLE}}", userRoleLabel)
    .replace("{{AVAILABLE_COMMANDS}}", availableCommands)
    // Recognition context — who this user is on record as (level, coins,
    // rank, etc.), built by the caller (ai.ts) from the bot's database.
    // Omitted entirely rather than left as a blank line when there's
    // nothing to say (e.g. the DB is unreachable).
    .replace(
      "{{USER_CONTEXT}}",
      userContext ? `User profile: ${userContext}` : "",
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userInput },
  ];

  const ctx = { api: bot, event: message, chatbotConfig };

  // Safety net: test_command flags `hasMedia: true` whenever it captured an
  // actual photo/video/document/etc. Those keys go here as soon as they're
  // produced and are only removed once send_result actually consumes them
  // (see below). Anything still left at the end — because the model
  // described the media in words instead of attaching it, or crashed out,
  // or hit the turn limit — gets force-forwarded so the user never loses
  // media the bot already fetched.
  const pendingMediaKeys = new Set<string>();

  const forwardPendingMedia = async (caption?: string): Promise<boolean> => {
    let captionAttached = false;
    for (const key of pendingMediaKeys) {
      const calls = takeCalls(key);
      if (!calls) continue;
      // Offer the caption to whichever key gets forwarded first that can
      // actually carry it — once attached, later keys forward as-is. Only
      // pass a caption to the very first eligible call across all keys.
      const result = await forwardCalls(
        bot,
        message.chat.id,
        calls,
        captionAttached ? undefined : caption,
      );
      captionAttached = captionAttached || result.captionAttached;
    }
    pendingMediaKeys.clear();
    return captionAttached;
  };

  const stopTyping = startTypingIndicator(bot, message.chat.id);

  try {
    let turns = 20; // Safety limit — prevents runaway tool-call loops

    while (turns-- > 0) {
      const response = await groq.chat.completions.create({
        model: DEFAULT_MODEL,
        messages,
        tools: chatTools,
        tool_choice: "auto",
      });

      const choice = response.choices[0]?.message;
      if (!choice) break;

      messages.push(choice);

      // Bare text with no tool call — send_result was never invoked, so
      // nothing has reached the chat yet. Forward any media fetched earlier
      // in the turn with this text as its caption (so it arrives as one
      // attachment, not media-then-separate-text); only fall back to
      // returning the text for a standalone message when there was no
      // media to carry it. Not every tool-use model reliably closes the
      // loop with a send_result call, so this text still has to
      // reach the user somehow.
      if (!choice.tool_calls || choice.tool_calls.length === 0) {
        const text = extractReplyText(choice.content || "");
        const captionAttached = await forwardPendingMedia(text || undefined);
        return captionAttached ? "" : text;
      }

      let deliveredViaSendResult = false;

      for (const toolCall of choice.tool_calls) {
        const tool = tools.find(
          (t) => t.config.name === toolCall.function.name,
        );

        if (!tool) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Error: Tool '${toolCall.function.name}' not found.`,
          });
          continue;
        }

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        try {
          const result = await tool.run(args, ctx);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: String(result),
          });

          if (tool.config.name === "test_command") {
            // Track any media key this call produced so it can be
            // force-forwarded later if send_result never references it.
            try {
              const parsed = JSON.parse(String(result));
              if (parsed?.hasMedia && typeof parsed.key === "string") {
                pendingMediaKeys.add(parsed.key);
              }
            } catch {
              // Not JSON (an error string) — nothing to track.
            }
          }

          if (tool.config.name === "send_result") {
            deliveredViaSendResult = true;
            // Keys the model actually attached were already consumed by
            // send_result (takeCalls deletes them) — stop tracking those
            // specifically so forwardPendingMedia doesn't try them again.
            const used = Array.isArray(args?.["attachment_keys"])
              ? (args["attachment_keys"] as unknown[])
              : [];
            for (const k of used) {
              if (typeof k === "string") pendingMediaKeys.delete(k);
            }
          }
        } catch (err) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Tool execution error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        }
      }

      // send_result already sent the reply directly — return '' so the
      // calling command doesn't send a duplicate message. Any media the
      // model fetched but didn't attach still gets forwarded first.
      if (deliveredViaSendResult) {
        await forwardPendingMedia();
        return "";
      }
    }

    const fallbackText =
      "I had to stop processing because the task required too many steps.";
    const captionAttached = await forwardPendingMedia(fallbackText);
    return captionAttached ? "" : fallbackText;
  } finally {
    // Every return path above (and any thrown error) funnels through here,
    // so the typing indicator never keeps refreshing after the turn ends.
    stopTyping();
  }
}
