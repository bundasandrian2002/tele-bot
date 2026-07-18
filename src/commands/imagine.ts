import { Config, Execute } from "@/types";
import axios from "axios";

export const config: Config = {
  name: "imagine",
  description: "Generate an image from a text prompt.",
  usage: "/imagine [prompt]",
  permission: "user",
  creator: "itsunknown",
};

interface ImagineResponse {
  status: string;
  result: string[];
}

export async function execute({ api, event, args }: Execute) {
  try {
    // Previously checked `args[0]?.length == 0`, which only catches an
    // explicitly-empty first argument — args[0] is `undefined` (not an
    // empty string) when no prompt is given at all, so that check
    // silently let `/imagine` with zero args through and sent the
    // literal string "undefined" to the API.
    if (!args.length) {
      await api.sendMessage(
        event.chat.id,
        `⚠ Invalid Command! \n\nUsage: ${config.usage}`,
      );
      return false;
    }

    // Join every word instead of only using args[0], so multi-word
    // prompts (the common case) aren't silently truncated to their
    // first word.
    const prompt = args.join(" ");

    const { data } = await axios.get<ImagineResponse>(
      `https://text-to-img.apis-bj-devs.workers.dev/?prompt=${encodeURIComponent(prompt)}`,
    );

    if (data.status !== "success" || !data.result?.length) {
      await api.sendMessage(event.chat.id, "Failed to generate that image.");
      return false;
    }

    const photos = data.result.map((url) => ({
      type: "photo" as const,
      media: url,
      caption: prompt,
    }));

    await api.sendMediaGroup(event.chat.id, photos);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    api.sendMessage(event.chat.id, `Error: ${message}`);
    return false;
  }
}
