import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("code")
    .setDescription("Run a coding task against this channel's repo; opens a PR")
    .addStringOption((opt) =>
      opt
        .setName("task")
        .setDescription("What should the agent do?")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask a question about this channel's repo (read-only)")
    .addStringOption((opt) =>
      opt
        .setName("question")
        .setDescription("What do you want to know?")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("repo")
    .setDescription("Manage the repo this channel works on")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set the active repo for this channel")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("owner/repo")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("show").setDescription("Show this channel's active repo"),
    ),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show running and queued tasks in this server"),
  new SlashCommandBuilder()
    .setName("cancel")
    .setDescription("Cancel the task running in this thread"),
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure AnywhereCode for this server")
    .addSubcommand((sub) =>
      sub
        .setName("role")
        .setDescription("Set which role may invoke /code (default: admins only)")
        .addRoleOption((opt) =>
          opt
            .setName("role")
            .setDescription("Role to allow; omit to reset to admins only")
            .setRequired(false),
        ),
    ),
].map((builder) => builder.toJSON());
