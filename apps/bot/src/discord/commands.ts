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
    .setName("connect")
    .setDescription("Connect services to AnywhereCode")
    .addSubcommand((sub) =>
      sub
        .setName("llm")
        .setDescription(
          "Connect your LLM (Anthropic API key, Claude subscription, or compatible provider)",
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("github").setDescription("Connect GitHub repositories"),
    ),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Show the connection status and usage for this server"),
  new SlashCommandBuilder()
    .setName("billing")
    .setDescription("Show this server's plan, usage, and upgrade link"),
  new SlashCommandBuilder()
    .setName("oss")
    .setDescription("OSS Community tier (free for public open-source servers)")
    .addSubcommand((sub) =>
      sub
        .setName("apply")
        .setDescription("Apply for the free OSS Community tier"),
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
    .setName("memory")
    .setDescription("Server Memory: per-repo conventions loaded into every run")
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("Show this channel's repo memory"),
    )
    .addSubcommand((sub) =>
      sub.setName("edit").setDescription("Edit the full memory doc (modal)"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Append a one-line rule")
        .addStringOption((opt) =>
          opt
            .setName("rule")
            .setDescription('e.g. "we use pnpm, never npm"')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("clear").setDescription("Delete this repo's memory"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("template")
        .setDescription("Start from a template")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Template")
            .setRequired(true)
            .addChoices(
              { name: "general", value: "general" },
              { name: "godot-gdscript", value: "godot-gdscript" },
              { name: "unity-csharp", value: "unity-csharp" },
            ),
        ),
    ),
  new SlashCommandBuilder()
    .setName("review")
    .setDescription("Have the agent review a pull request (read-only, /ask quota)")
    .addIntegerOption((opt) =>
      opt
        .setName("pr")
        .setDescription("Pull request number on this channel's repo")
        .setMinValue(1)
        .setRequired(true),
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
    )
    .addSubcommand((sub) =>
      sub
        .setName("review")
        .setDescription("Auto-review every opened PR on a repo")
        .addStringOption((opt) =>
          opt
            .setName("repo")
            .setDescription("owner/repo")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel for review summaries; omit to turn auto-review off")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("shiplog")
        .setDescription("Auto-post merged agent PRs to a channel (build in public)")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Ship-log channel; omit to turn it off")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("issues")
        .setDescription("Feed new GitHub issues into a channel as Run/Dismiss cards")
        .addStringOption((opt) =>
          opt
            .setName("repo")
            .setDescription("owner/repo")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel for issue cards; omit to turn the feed off")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("labels")
            .setDescription("Comma-separated label allowlist (empty = all issues)")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("trust")
            .setDescription("Minimum issue-author trust")
            .setRequired(false)
            .addChoices(
              { name: "anyone", value: "any" },
              { name: "contributors+", value: "contributor" },
              { name: "org members+", value: "member" },
              { name: "owners only", value: "owner" },
            ),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("daily_cap")
            .setDescription("Max cards per UTC day (default 10)")
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false),
        ),
    ),
].map((builder) => builder.toJSON());
