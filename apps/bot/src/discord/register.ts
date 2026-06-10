import { REST, Routes } from "discord.js";
import type { Config } from "../config.js";
import { commands } from "./commands.js";

export async function registerCommands(config: Config): Promise<void> {
  const rest = new REST().setToken(config.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
    body: commands,
  });
  console.log(`Registered ${commands.length} application commands.`);
}

// CLI entry point: pnpm register-commands
if (process.argv[1]?.endsWith("register.ts") || process.argv[1]?.endsWith("register.js")) {
  const { loadConfig } = await import("../config.js");
  await registerCommands(loadConfig());
}
