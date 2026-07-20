import { Config } from "@/types";

/**
 * Agent Command Guard — LLM-readable constraint inspector.
 *
 * Mirrors Cat-Bot's agent-command-guard.lib.ts: a structured pre-flight check
 * that test_command runs before executing a command, returning a typed
 * result the agent can quote directly in its reply instead of a generic
 * "execution was blocked" fallback.
 *
 * Enforces two things: the command's declared `permission` (unchanged), and
 * a per-user rate limit on how many commands a non-admin can run through the
 * agent (new — see checkAgentCommandRateLimit below). Both checks are kept
 * here rather than inline in test_command.ts so the gate lives in exactly
 * one place.
 */
export type CommandGuardResult = {
  /** Whether the command is permitted to execute for this user. */
  allowed: boolean;
  /**
   * Human-readable explanation the agent can quote directly in its reply.
   * null when allowed === true — no message needed.
   */
  reason: string | null;
};

/**
 * Inspects whether `commandName` is runnable by the invoking user, without
 * executing it or sending anything to the chat.
 *
 * @param cfg      Command module's config (permission field).
 * @param isAdmin  Whether the invoking user is a configured bot admin.
 */
export function inspectCommandConstraints(
  cfg: Config,
  isAdmin: boolean,
): CommandGuardResult {
  if (cfg.permission === "admin" && !isAdmin) {
    return {
      allowed: false,
      reason: `"${cfg.name}" is admin-only and this user is not an admin.`,
    };
  }

  return { allowed: true, reason: null };
}

// ---------------------------------------------------------------------------
// Agent command rate limit
// ---------------------------------------------------------------------------

/**
 * How many commands a non-admin can run through the agent (test_command)
 * within AGENT_COMMAND_LIMIT_WINDOW_MS before being blocked. Admins are
 * exempt entirely — see checkAgentCommandRateLimit.
 */
const AGENT_COMMAND_LIMIT = 1;
const AGENT_COMMAND_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory only, same tradeoff as rankup.ts's XP cooldown and
 * autogreet.ts's greet cooldown: per-process, resets on restart, no DB
 * round-trip needed for something this cheap to get slightly wrong.
 * Keyed by user id (not per-chat) — the limit is about the person, not
 * which chat they asked from.
 */
const usage = new Map<number, { count: number; windowStart: number }>();

/**
 * Consumes one slot of a non-admin's agent-command quota and reports
 * whether this call is allowed. Call once per command the agent is about
 * to run (i.e. once per entry in test_command's `commands` array) — a
 * single test_command call with 3 commands in it uses all 3 slots at once,
 * same as three separate calls would.
 *
 * Admins always return allowed: true and never consume a slot.
 */
export function checkAgentCommandRateLimit(
  userId: number,
  isAdmin: boolean,
): CommandGuardResult {
  if (isAdmin) return { allowed: true, reason: null };

  const now = Date.now();
  const entry = usage.get(userId);

  if (!entry || now - entry.windowStart >= AGENT_COMMAND_LIMIT_WINDOW_MS) {
    usage.set(userId, { count: 1, windowStart: now });
    return { allowed: true, reason: null };
  }

  if (entry.count >= AGENT_COMMAND_LIMIT) {
    const hoursLeft = Math.ceil((AGENT_COMMAND_LIMIT_WINDOW_MS - (now - entry.windowStart)) / (60 * 60 * 1000));
    return {
      allowed: false,
      reason:
        `Agent command limit reached (${AGENT_COMMAND_LIMIT} per 24h for non-admins). ` +
        `Resets in about ${hoursLeft}h, or ask a bot admin to run it for you.`,
    };
  }

  entry.count += 1;
  return { allowed: true, reason: null };
}
