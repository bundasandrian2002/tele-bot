import { AgentContext, AgentTool } from "@/types";
import { forwardCalls, takeCalls } from "@/agent/lib/commandResultStore";

export const config: AgentTool["config"] = {
  name: "send_result",
  description:
    "Deliver your final reply to the user. This is the only way anything reaches the chat — " +
    "call it exactly once at the end of your turn, even for a plain conversational reply with " +
    "no command involved. Run every test_command call you need first, then pass all their " +
    "`key` values in `attachment_keys` here to forward the combined media/text in one delivery. " +
    "When one of those keys produced an actual photo/video/document/etc., `message` is attached " +
    "as that media's caption — a real attachment with your reply on it, not a separate text " +
    "bubble — instead of being sent on its own (unless it's too long to fit as a caption, in " +
    "which case it's sent separately as a fallback).",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Your reply, written in your own words. This is what the user sees first.",
      },
      attachment_keys: {
        type: "array",
        items: { type: "string" },
        description:
          "Zero or more `key` values returned by test_command, to forward their captured " +
          "media/output alongside your message. Omit or pass [] when nothing needs forwarding.",
      },
    },
    required: ["message"],
  },
};

export const run: AgentTool["run"] = async (
  { message, attachment_keys }: { message?: string; attachment_keys?: string[] },
  ctx: AgentContext,
) => {
  const chatId = ctx.event.chat.id;

  try {
    let forwarded = 0;
    let captionAttached = false;

    for (const key of attachment_keys ?? []) {
      const calls = takeCalls(key);
      if (!calls) continue;

      // Only offer the caption to the first forwarding call that can
      // actually take it — once attached, later calls forward as-is.
      const result = await forwardCalls(
        ctx.api,
        chatId,
        calls,
        captionAttached ? undefined : message,
      );
      forwarded += result.forwarded;
      captionAttached = captionAttached || result.captionAttached;
    }

    // Fall back to a plain text message only when the reply couldn't ride
    // along as a media caption — either because nothing with an attachment
    // was forwarded, or the message was too long to fit as a caption.
    if (message && !captionAttached) {
      await ctx.api.sendMessage(chatId, message);
    }

    return forwarded > 0
      ? `Delivered. ${forwarded} additional item(s) forwarded.`
      : "Delivered.";
  } catch (err) {
    return `Delivery failed: ${err instanceof Error ? err.message : String(err)}`;
  }
};
