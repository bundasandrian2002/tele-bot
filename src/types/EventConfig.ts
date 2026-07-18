export type EventConfig = {
  name: string;
  description: string;
  creator: string;

  /**
   * The node-telegram-bot-api event this listens on, e.g. "message",
   * "new_chat_members", "left_chat_member", "callback_query", etc.
   * This is what makes registration dynamic — handleEvents.ts groups
   * every event file by this value instead of hardcoding event names.
   */
  trigger: string;

  /**
   * Only relevant when trigger is "message". When true, messages that
   * start with the configured command prefix are skipped before this
   * event runs, so passive watchers (like alldl) don't double-handle
   * a message that's already routed to an explicit command by
   * handleCommands.ts.
   */
  skipCommandPrefix?: boolean;
};
