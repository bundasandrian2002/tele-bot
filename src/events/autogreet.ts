import { EventConfig, EventExecute } from "@/types";

export const config: EventConfig = {
  name: "autogreet",
  description:
    "Passively replies with a time-of-day greeting (good morning/afternoon/evening/night) " +
    "whenever a message opens with a greeting word like 'hi', 'hello', or 'good morning'.",
  creator: "itsunknown",
  // Passive watcher, same shape as botname/autodl: looks at every ordinary
  // message and decides for itself whether it opens with a greeting.
  trigger: "message",
  // "/hi" isn't a real command, but staying consistent with botname.ts —
  // an explicit command should never also trigger a passive watcher.
  skipCommandPrefix: true,
};

// Matched only at the very start of the message (after stripping leading
// punctuation/emoji) rather than anywhere in it — "hi" is common enough as
// a word-fragment ("history", "this") that an anywhere-in-message match
// would false-positive constantly. \b after each alternative still keeps
// "hi" from matching "hidden", etc.
const GREETING_RE =
  /^(good\s*morning|good\s*afternoon|good\s*evening|good\s*night|gm|gn|morning|afternoon|evening|hi+|hello+|hey+|yo+)\b/i;

// Strips a small set of common leading characters (emoji, punctuation,
// quote marks) before testing GREETING_RE, so "👋 good morning!" still
// matches even though the message doesn't literally start with a letter.
const LEADING_NOISE_RE =
  /^[\s"'“”‘’.,!?—-]*(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})*[\s"'“”‘’.,!?—-]*/u;

// Per-chat-per-user cooldown so someone repeatedly saying "hi" doesn't get
// re-greeted on every single message — same tradeoff as rankup.ts's XP
// cooldown: in-memory and per-process, resets on restart.
const COOLDOWN_MS = 5 * 60_000;
const lastGreetedAt = new Map<string, number>();

type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

function currentPeriod(): GreetingPeriod {
  // Server-local time — this bot has no per-chat/per-user timezone
  // setting, so "now" is whatever timezone the process is running in.
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

const GREETING_TEXT: Record<GreetingPeriod, { emoji: string; label: string }> =
  {
    morning: { emoji: "🌅", label: "Good morning" },
    afternoon: { emoji: "☀️", label: "Good afternoon" },
    evening: { emoji: "🌇", label: "Good evening" },
    night: { emoji: "🌙", label: "Good night" },
  };

export async function execute({ api, event }: EventExecute) {
  try {
    const text = event.text?.trim();
    if (!text) return;

    const user = event.from;
    if (!user || user.is_bot) return;

    const stripped = text.replace(LEADING_NOISE_RE, "");
    if (!GREETING_RE.test(stripped)) return;

    const key = `${event.chat.id}:${user.id}`;
    const now = Date.now();
    const last = lastGreetedAt.get(key) ?? 0;
    if (now - last < COOLDOWN_MS) return;
    lastGreetedAt.set(key, now);

    const { emoji, label } = GREETING_TEXT[currentPeriod()];
    const isGroup =
      event.chat.type === "group" || event.chat.type === "supergroup";

    if (isGroup) {
      // Addressed to the whole room rather than just the person who
      // happened to trigger it — "Good morning, everyone!" reads as a
      // greeting to the group, not a reply singling one member out.
      await api.sendMessage(event.chat.id, `${emoji} *${label}, everyone!*`);
    } else {
      await api.sendMessage(event.chat.id, `${emoji} *${label}!*`);
    }
  } catch (error) {
    console.error("autogreet event error:", error);
  }
}
