import { Config } from "@/types";

/**
 * Agent Command Guard — LLM-readable constraint inspector.
 *
 * Mirrors Cat-Bot's agent-command-guard.lib.ts: a structured pre-flight check
 * that test_command runs before executing a command, returning a typed
 * result the agent can quote directly in its reply instead of a generic
 * "execution was blocked" fallback.
 *
 * This bot has no ban list or cooldown store (unlike Cat-Bot's DB-backed
 * version) — the only constraint it enforces is the command's declared
 * `permission`. The guard is still a separate module so that gate lives in
 * exactly one place and test_command doesn't duplicate the check inline.
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
