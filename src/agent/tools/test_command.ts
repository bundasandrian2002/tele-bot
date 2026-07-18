import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import TelegramBot from "node-telegram-bot-api";
import { AgentContext, AgentTool, Config, Execute } from "@/types";
import {
  generateKey,
  setCalls,
  InterceptedCall,
  MEDIA_METHODS,
} from "@/agent/lib/commandResultStore";
import { inspectCommandConstraints } from "@/agent/lib/agentCommandGuard";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Methods a command might call that actually produce something worth
// forwarding to the user. Everything else on the bot API passes through
// untouched (e.g. getChatMember, banChatMember) — commands like /kick still
// need those to work for real, only the *message-sending* half is captured.
const CAPTURED_METHODS = new Set([
  "sendMessage",
  "sendPhoto",
  "sendVideo",
  "sendDocument",
  "sendAudio",
  "sendAnimation",
  "sendVoice",
  "setMessageReaction",
]);

// MEDIA_METHODS (imported above) is the subset of CAPTURED_METHODS that are
// actual media attachments rather than plain text or a reaction — used to
// flag `hasMedia` so the agent (and the fallback safety net in agent.ts)
// know a photo/video/etc. is waiting to be forwarded, not just describable
// in words.

// 10-minute hard ceiling for the whole batch — mirrors Cat-Bot's
// test_command timeout. Commands that stall on network I/O (external API
// calls, image downloads inside a command handler) would otherwise block
// the agent loop indefinitely with no recovery path.
const EXECUTION_TIMEOUT_MS = 10 * 60 * 1_000;

export const config: AgentTool["config"] = {
  name: "test_command",
  description:
    "Silently execute one or more of this bot's existing commands and capture what they " +
    "would send, without delivering anything to the chat yet. Always use the `commands` " +
    "array, even for a single command — when the user asks for several things at once, " +
    "pass every command in one call so their combined output can be summarized and " +
    "delivered together. Returns a `key` plus a plain-text `summary` of what was " +
    "captured — read the summary, then call send_result once with your own reply text " +
    "and this `key` in `attachment_keys` to forward any media/text it produced.",
  parameters: {
    type: "object",
    properties: {
      commands: {
        type: "array",
        items: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Command name, without the prefix (e.g. 'shotiv0', not '/shotiv0').",
            },
            args: {
              type: "array",
              items: { type: "string" },
              description: "Arguments to pass, same as typing them after the command name. Pass [] for none.",
            },
          },
          required: ["command", "args"],
        },
        description: "List of commands to run in sequence, in one silent batch.",
      },
    },
    required: ["commands"],
  },
};

function summarizeCall(call: InterceptedCall): string | null {
  if (call.method === "setMessageReaction") return null;

  const prefix = call.sourceCommand ? `[${call.sourceCommand}] ` : "";

  if (call.method === "sendMessage") {
    return `- ${prefix}text: ${String(call.args[1] ?? "")}`;
  }

  // sendPhoto/sendVideo/sendDocument/sendAudio/sendAnimation/sendVoice all
  // share the (chatId, source, options?) shape, with an optional caption.
  const opts = (call.args[2] ?? {}) as { caption?: string };
  return `- ${prefix}${call.method}${opts.caption ? ` (caption: ${opts.caption})` : ""}`;
}

async function loadCommandModule(
  name: string,
): Promise<{ mod: { execute?: (e: Execute) => Promise<unknown>; config?: Config } | null; error: string | null }> {
  const commandsDir = path.join(__dirname, "../../commands");
  const file = fs
    .readdirSync(commandsDir)
    .find((f) => f.replace(path.extname(f), "").toLowerCase() === name);

  if (!file) return { mod: null, error: `Command '${name}' not found.` };

  try {
    const mod = (await import(pathToFileURL(path.join(commandsDir, file)).href)) as {
      execute?: (e: Execute) => Promise<unknown>;
      config?: Config;
    };
    if (!mod.execute || !mod.config) {
      return { mod: null, error: `Command '${name}' has no execute function or config.` };
    }
    return { mod, error: null };
  } catch (err) {
    return {
      mod: null,
      error: `Error loading '${name}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const run: AgentTool["run"] = async (
  { commands }: { commands?: Array<{ command?: string; args?: string[] }> },
  ctx: AgentContext,
) => {
  const cmdsToRun = commands ?? [];
  if (cmdsToRun.length === 0) {
    return "Error: You must provide a non-empty `commands` array.";
  }

  const execution = (async (): Promise<string> => {
    const fromId = ctx.event.from?.id ?? -1;
    const isAdmin = ctx.chatbotConfig.admins.includes(fromId);

    const intercepted: InterceptedCall[] = [];
    const errors: string[] = [];
    let currentRunningCommand = "";

    const mockApi = new Proxy(ctx.api, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && CAPTURED_METHODS.has(prop)) {
          return async (...callArgs: unknown[]) => {
            intercepted.push({
              method: prop,
              args: callArgs,
              sourceCommand: currentRunningCommand,
            });
            // Fake a Message-shaped id so commands that inspect the return
            // value (rare, but some await the sent message) don't crash.
            return { message_id: -1 };
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    for (const cmdObj of cmdsToRun) {
      const name = (cmdObj.command ?? "").toLowerCase().trim();
      const args = cmdObj.args ?? [];

      if (!name) {
        errors.push("Skipped an entry with no command name.");
        continue;
      }

      const { mod, error } = await loadCommandModule(name);
      if (!mod || error) {
        errors.push(error ?? `Command '${name}' not found.`);
        continue;
      }

      // Admin-gated commands stay gated for the agent too — this must not
      // become a backdoor around the same permission check enforced in
      // handleCommands.ts.
      const guard = inspectCommandConstraints(mod.config as Config, isAdmin);
      if (!guard.allowed) {
        errors.push(`Command '${name}' blocked: ${guard.reason}`);
        continue;
      }

      currentRunningCommand = name;
      try {
        await mod.execute!({
          api: mockApi as unknown as TelegramBot,
          event: ctx.event,
          args,
          chatbotConfig: ctx.chatbotConfig,
        });
      } catch (err) {
        errors.push(
          `Error running '${name}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (intercepted.length === 0) {
      if (errors.length > 0) return `Execution errors: ${errors.join(" ")}`;
      return "Commands ran but produced nothing to send.";
    }

    const key = generateKey();
    setCalls(key, intercepted);

    const hasMedia = intercepted.some((c) => MEDIA_METHODS.has(c.method));
    const summaryLines = intercepted.map(summarizeCall).filter(Boolean);
    if (errors.length > 0) summaryLines.push(...errors.map((e) => `- error: ${e}`));

    return JSON.stringify(
      {
        key,
        hasMedia,
        callCount: intercepted.length,
        summary: summaryLines.length > 0 ? summaryLines.join("\n") : "(no text/caption)",
        note: hasMedia
          ? "This produced an actual photo/video/document/etc. Your `message` text CANNOT " +
            "contain it — you MUST pass this `key` in send_result's `attachment_keys` or the " +
            "user will never receive it. Never describe media in words as a substitute for " +
            "forwarding it."
          : "Read `summary` to see what these commands would send, write your own reply " +
            "synthesizing all of it, then call send_result once with your `message` and this " +
            "`key` in `attachment_keys` to forward it.",
      },
      null,
      2,
    );
  })();

  // Race the batch against a fixed-duration timer. Resolving (not
  // rejecting) the timeout keeps the return type a plain string without an
  // extra try/catch at the call site. Unref'd so it can't block process exit.
  const timeout = new Promise<string>((resolve) => {
    const t = setTimeout(
      () =>
        resolve(
          "Error: test_command timed out after 10 minutes. The command(s) may have stalled on network I/O.",
        ),
      EXECUTION_TIMEOUT_MS,
    );
    t.unref();
  });

  return Promise.race([execution, timeout]);
};
