import TelegramBot, { Message } from "node-telegram-bot-api";
import { ChatbotConfig } from "./ChatbotConfig";

/**
 * The context handed to every agent tool's run() — a trimmed-down version
 * of Execute, since tools operate on behalf of the chat that triggered the
 * agent rather than a freshly-parsed command invocation (no args of their
 * own; the LLM supplies whatever arguments a tool needs).
 */
export type AgentContext = {
  api: TelegramBot;
  event: Message;
  chatbotConfig: ChatbotConfig;
};

/**
 * Standard interface for a dynamically-loaded agent tool. Mirrors the
 * config/execute shape of a regular command so the same "drop a file in
 * the folder" pattern works for both.
 */
export type AgentTool = {
  config: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any, ctx: AgentContext) => Promise<string> | string;
};
