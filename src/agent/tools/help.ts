import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { AgentTool, Config } from "@/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config: AgentTool["config"] = {
  name: "help",
  description:
    "Get the full details (description, usage, permission, author) for one of this " +
    "bot's commands by exact name. Use this before test_command if you're unsure of " +
    "a command's arguments.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Exact command name, without the prefix (e.g. 'kick', not '/kick').",
      },
    },
    required: ["command"],
  },
};

export const run: AgentTool["run"] = async ({
  command,
}: {
  command?: string;
}) => {
  const name = (command ?? "").toLowerCase().trim();
  if (!name) return "Error: You must provide a command name.";

  const commandsDir = path.join(__dirname, "../../commands");
  const file = fs
    .readdirSync(commandsDir)
    .find((f) => f.replace(path.extname(f), "").toLowerCase() === name);

  if (!file) return `No command named "${name}" exists.`;

  try {
    const mod = (await import(pathToFileURL(path.join(commandsDir, file)).href)) as {
      config?: Config;
    };
    const cfg = mod.config;
    if (!cfg) return `Command "${name}" is missing a config.`;

    return [
      `Name: ${cfg.name}`,
      `Description: ${cfg.description}`,
      `Usage: ${cfg.usage}`,
      `Permission: ${cfg.permission}`,
      `Author: ${cfg.creator}`,
    ].join("\n");
  } catch (err) {
    return `Error reading command "${name}": ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
};
