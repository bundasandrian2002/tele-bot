export type ChatbotConfig = {
  admins: number[];
  prefix: string;
  // When a non-command message contains this (case-insensitive), the
  // botname event passively triggers the AI agent — e.g. "hey Kitty, ..."
  // instead of requiring the explicit /ai command.
  botname?: string;
};
