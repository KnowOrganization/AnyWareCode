import { REST, Routes } from "discord.js";
import { loadConfig } from "../config.js";
import { commands } from "./commands.js";

const config = loadConfig();
const rest = new REST().setToken(config.DISCORD_TOKEN);

await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
  body: commands,
});
console.log(`Registered ${commands.length} application commands.`);
