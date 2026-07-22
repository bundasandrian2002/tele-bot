export type ChatbotConfig = {
  admins: number[];
  prefix: string;
  // When a non-command message contains this (case-insensitive), the
  // botname event passively triggers the AI agent — e.g. "hey Kitty, ..."
  // instead of requiring the explicit /ai command.
  botname?: string;
  // When true, only chatbotConfig.admins can use commands or trigger the
  // "user-facing feature" events (autodl, autogreet, botname/AI, rankup —
  // see EventConfig.alwaysActive for what's exempt). Toggled at runtime via
  // /developer (src/commands/developer.ts) and persisted to bot_settings so
  // it survives a restart, same as prefix. Defaults to false.
  developerMode?: boolean;
  // bot_instances.id for bots running under the multi-user web dashboard
  // (see src/bot/manager.ts). Lets commands like /prefix and /developer
  // persist their setting scoped to this tenant instead of a shared
  // global key. Undefined for any code path not going through the
  // manager (there isn't one anymore, but commands still guard for it).
  instanceId?: number;
};
