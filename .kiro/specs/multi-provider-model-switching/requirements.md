# Requirements Document

## Introduction

AnyWareCode is a Discord coding-agent bot built on a bring-your-own-LLM (BYO-LLM) model: there is no platform key, and every guild connects its own credential. Today the system is Anthropic-centric. Admins connect a provider via `/connect llm`, which offers three provider types — `anthropic_api_key`, `claude_oauth`, and `custom` (an Anthropic-compatible base URL plus a pinned model). Credentials are stored AES-256-GCM-encrypted per guild. Every direct LLM call the bot makes (mention classification, replies, planning, memory suggestions, standup extraction, and credential probes) flows through `buildAnthropicHeaders` to the Anthropic Messages API, and the runner injects `ANTHROPIC_*` environment variables for the Claude Code SDK.

This feature adds two new providers — **OpenAI/Codex** and **OpenRouter** — each connected with an API key, and a **model-switching capability** that lets an admin change the active model within whichever provider the guild has configured. OpenAI and OpenRouter expose the OpenAI-compatible Chat Completions request/response shape, which differs from the Anthropic Messages shape the bot currently assumes; reconciling those two shapes on both the bot path and the task/runner path is the central design concern. Model switching is unrestricted by subscription tier at this stage ("free for now").

This document specifies the observable behavior of provider configuration, credential validation, model selection, and request routing. The mechanics of shape translation are deferred to design.

## Assumptions and Open Questions

These items materially affect design and are flagged for confirmation during review. The requirements below encode the stated default for each; if a default is wrong, the corresponding requirements will be revised.

1. **Provider identifiers.** New provider types are named `openai` (covering OpenAI and Codex models) and `openrouter`. "Codex" is treated as a set of models reachable through the OpenAI provider rather than a separate provider type. (Confirm whether Codex needs a distinct endpoint or credential.)
2. **Runner/agent execution for OpenAI-compatible providers.** The Claude Code SDK used by the runner speaks the Anthropic API; the `custom` path works only because it targets an Anthropic-compatible endpoint. OpenAI and OpenRouter are not Anthropic-compatible. The requirements assume the task/runner path must route OpenAI-compatible providers through a translation/adapter layer (or an alternate engine) so that `/code` and `/ask` tasks function. The exact mechanism is a design decision; this document only requires that tasks either run on the configured provider or fail with a clear, actionable message rather than silently misbehaving.
3. **Model lists are not hard-coded per provider.** Admins type a model identifier (validated against the provider) rather than picking from a bot-maintained catalog, mirroring the existing `custom` provider. A curated suggestion list MAY be offered but is not required.
4. **"Free for now"** means model switching is available to all guilds regardless of plan tier; no new paywall or usage cap is introduced by this feature.
5. **Authorization.** Configuring a provider and switching models are admin-only actions, gated on the Discord `ManageGuild` permission, consistent with the existing `/connect llm` flow.

## Glossary

- **Bot**: The Discord bot process (`apps/bot`) that handles slash commands, mention classification, and task orchestration, and makes direct LLM calls.
- **Runner**: The agent container (`apps/runner`) that performs `/code` and `/ask` work using the Claude Code SDK and receives a `TaskSpec` containing the resolved credential.
- **Admin**: A Discord guild member holding the `ManageGuild` permission.
- **Provider_Type**: The kind of LLM connection configured for a guild. After this feature the set is `anthropic_api_key`, `claude_oauth`, `custom`, `openai`, and `openrouter`.
- **Anthropic_Provider**: A guild configured with `anthropic_api_key` or `claude_oauth`.
- **OpenAI_Provider**: A guild configured with the `openai` Provider_Type (OpenAI and Codex models).
- **OpenRouter_Provider**: A guild configured with the `openrouter` Provider_Type.
- **OpenAI_Compatible_Provider**: An OpenAI_Provider or OpenRouter_Provider; both use the OpenAI Chat Completions request/response shape.
- **Connect_Flow**: The `/connect llm` provider chooser and credential modal handled in `connect.ts`.
- **Credential_Store**: The AES-256-GCM-encrypted, per-guild credential persistence backed by the `guilds` table.
- **Credential_Validator**: The component that performs a minimal live request to confirm a submitted credential is usable before persisting it.
- **Selected_Model**: The model identifier a guild has chosen for its configured Provider_Type, persisted per guild.
- **Model_Selector**: The admin-facing capability that views and changes the Selected_Model for the guild's configured Provider_Type.
- **Default_Model**: The model identifier used for a Provider_Type when the guild has not chosen a Selected_Model.
- **Chat_Path**: The bot-side mention flow (`classifyIntent`, `generateChatReply`) and other direct bot LLM calls.
- **Task_Path**: The `/ask` and `/code` flow that resolves a credential and runs work in the Runner.

## Requirements

### Requirement 1: Connect an OpenAI/Codex provider

**User Story:** As an admin, I want to connect an OpenAI API key, so that my guild can use OpenAI and Codex models for the bot and coding tasks.

#### Acceptance Criteria

1. WHEN an Admin opens the Connect_Flow, THE Bot SHALL present an "OpenAI" provider option alongside the existing provider options.
2. WHEN an Admin selects the OpenAI option, THE Bot SHALL present a credential modal that collects an OpenAI API key field accepting 1 to 512 characters and a model identifier field accepting 0 to 256 characters.
3. WHEN an Admin submits an OpenAI API key and model identifier that pass credential validation as specified in Requirement 3, THE Bot SHALL store the credential as Provider_Type `openai` in the Credential_Store with the submitted model, trimmed of leading and trailing whitespace, recorded as the Selected_Model.
4. WHEN the Bot persists the OpenAI credential, THE Bot SHALL record the credential-set timestamp for the guild as a UTC value with at least second precision at the time of persistence.
5. IF a non-admin invokes the OpenAI connection action, THEN THE Bot SHALL reject the action, SHALL NOT present the credential modal, SHALL persist nothing, and SHALL respond in an ephemeral invoker-only message that only server admins can connect an LLM.
6. WHERE the model identifier field is empty or whitespace-only on submission, THE Bot SHALL apply the OpenAI Default_Model rather than persisting an empty model.

### Requirement 2: Connect an OpenRouter provider

**User Story:** As an admin, I want to connect an OpenRouter API key, so that my guild can use any model OpenRouter exposes.

#### Acceptance Criteria

1. WHEN an Admin opens the Connect_Flow, THE Bot SHALL present an "OpenRouter" provider option alongside the existing provider options.
2. WHEN an Admin selects the OpenRouter option, THE Bot SHALL present a credential modal that collects an OpenRouter API key field accepting up to 512 characters and a model identifier field accepting up to 200 characters.
3. WHEN an Admin submits an OpenRouter API key and model identifier that pass credential validation as specified in Requirement 3, THE Bot SHALL store the credential as Provider_Type `openrouter` in the Credential_Store with the submitted model recorded as the Selected_Model.
4. WHEN the Bot persists the OpenRouter credential, THE Bot SHALL record the credential-set timestamp for the guild as the time of persistence.
5. IF a non-admin invokes the OpenRouter connection action, THEN THE Bot SHALL reject the action, SHALL NOT present the credential modal, and SHALL respond in an ephemeral message that only server admins can connect an LLM.
6. WHERE the model identifier field is empty or whitespace-only on submission, THE Bot SHALL apply the OpenRouter Default_Model rather than persisting an empty model.
7. IF an Admin submits the OpenRouter credential modal with an empty or whitespace-only API key, THEN THE Bot SHALL reject the submission, SHALL NOT persist any credential, and SHALL respond that an API key is required.

### Requirement 3: Validate credentials before persistence

**User Story:** As an admin, I want my submitted credential checked before it is saved, so that I find out immediately if it is wrong instead of when a task fails.

#### Acceptance Criteria

1. WHEN an Admin submits an OpenAI_Compatible_Provider credential, THE Credential_Validator SHALL issue a single live request to the provider using the OpenAI Chat Completions shape with the smallest payload accepted by that shape, and SHALL complete this validation before the credential is persisted.
2. WHEN the Credential_Validator issues the validation request, THE Credential_Validator SHALL wait no longer than 10 seconds for a response before treating the request as unable to reach the provider.
3. IF the validation request returns an authentication failure status, THEN THE Bot SHALL reject the submission, SHALL NOT persist the credential, and SHALL respond with a message indicating that the credential check failed.
4. IF the validation request returns a success status, or returns a parameter-level error status that nonetheless indicates the credential authenticated, THEN THE Bot SHALL treat the credential as valid and SHALL persist it.
5. IF the validation request cannot reach the provider, or no response is received within the 10-second limit, THEN THE Bot SHALL reject the submission, SHALL NOT persist the credential, and SHALL respond with a message indicating that the connection failed.
6. THE Bot SHALL exclude the submitted API key value and any authorization header value from every user-facing validation response.

### Requirement 4: Switch the model within the configured provider

**User Story:** As an admin, I want to change which model my configured provider uses, so that I can move between models without reconnecting credentials.

#### Acceptance Criteria

1. WHEN an Admin invokes the Model_Selector for a guild that has a configured Provider_Type, THE Bot SHALL display the guild's effective model (the Selected_Model when set, otherwise the Provider_Type's Default_Model) and allow entry of a new model identifier of 1 to 200 characters.
2. WHEN an Admin submits a new model identifier through the Model_Selector, THE Bot SHALL persist the submitted identifier as the guild's Selected_Model for the configured Provider_Type without altering the stored credential or the credential-set timestamp.
3. IF an Admin invokes the Model_Selector for a guild that has no configured Provider_Type, THEN THE Bot SHALL respond that a provider must be connected first via `/connect llm` and SHALL NOT change any stored model value.
4. IF a member without the ManageGuild permission invokes the Model_Selector, THEN THE Bot SHALL reject the action, SHALL NOT change any stored model value, and SHALL respond that only server admins can change the model.
5. WHEN the Bot persists a new Selected_Model, THE Bot SHALL confirm the change by naming the new Selected_Model in the response.
6. THE Bot SHALL allow model switching for a guild on any subscription tier without imposing a billing charge, a paywall, or a usage cap.

### Requirement 5: Provider-scoped model selection and defaults

**User Story:** As an admin, I want model choices scoped to the provider I configured, so that switching models always targets the right provider.

#### Acceptance Criteria

1. WHILE a guild is configured as an OpenAI_Provider, THE Model_Selector SHALL apply submitted model identifiers to the OpenAI_Provider only and SHALL NOT modify the Selected_Model stored for any other Provider_Type.
2. WHILE a guild is configured as an OpenRouter_Provider, THE Model_Selector SHALL apply submitted model identifiers to the OpenRouter_Provider only and SHALL NOT modify the Selected_Model stored for any other Provider_Type.
3. WHILE a guild is configured as an Anthropic_Provider, THE Model_Selector SHALL apply submitted model identifiers to the Anthropic_Provider only and SHALL NOT modify the Selected_Model stored for any other Provider_Type.
4. WHEN a guild has a configured Provider_Type but no Selected_Model, THE Bot SHALL use that Provider_Type's Default_Model for that guild.
5. WHEN an Admin completes the Connect_Flow, THE Bot SHALL set the Selected_Model to the value submitted in the Connect_Flow in all cases, regardless of whether the Provider_Type changed, and SHALL NOT retain a Selected_Model from a previous configuration.
6. IF a model identifier submitted to the Model_Selector is empty, exceeds 256 characters, or is not a valid model identifier for the guild's configured Provider_Type, THEN THE Model_Selector SHALL reject the submission, SHALL retain the previously stored Selected_Model (or the Provider_Type's Default_Model if none was stored), and SHALL return an error response indicating that the submitted model is not available for the configured Provider_Type.

### Requirement 6: Bot direct LLM calls use the provider's request shape

**User Story:** As a guild member, I want @mentions and replies to work on whatever provider my admin configured, so that the bot responds correctly regardless of provider.

#### Acceptance Criteria

1. WHEN the Bot makes a direct LLM call for a guild configured as an OpenAI_Compatible_Provider, THE Bot SHALL send the request using the OpenAI Chat Completions request shape and the guild's effective model (the Selected_Model when set, otherwise the OpenAI_Compatible_Provider Default_Model).
2. WHEN the Bot receives a successful response from an OpenAI_Compatible_Provider, THE Bot SHALL read the generated reply content from the OpenAI Chat Completions response shape.
3. WHEN the Bot makes a direct LLM call for a guild configured as an Anthropic_Provider, THE Bot SHALL send the request using the Anthropic Messages request shape.
4. WHEN the Bot performs mention classification for a guild configured as an OpenAI_Compatible_Provider, THE Bot SHALL produce an intent decision drawn from the same set of intent categories, carrying the same decision attributes, and yielding an identical downstream task-routing outcome as the decision produced for an Anthropic_Provider given identical input.
5. IF an OpenAI_Compatible_Provider response has an empty body, an unparseable structure, or a missing required decision attribute, THEN THE Bot SHALL fall back to a conversational reply rather than launching a task.
6. IF an OpenAI_Compatible_Provider returns a non-success response, THEN THE Bot SHALL map the failure to one of the existing failure-mode categories and respond using that category's existing failure-mode message rather than a generic failure string.
7. IF a direct LLM call to an OpenAI_Compatible_Provider does not respond within 60 seconds, THEN THE Bot SHALL stop waiting and respond using the existing failure-mode messaging rather than launching a task.

### Requirement 7: Tasks run on the configured provider and selected model

**User Story:** As a guild member, I want `/code` and `/ask` to run on my guild's configured provider and model, so that coding work uses the LLM I chose.

#### Acceptance Criteria

1. WHEN the Task_Path resolves a credential for a guild configured as an OpenAI_Compatible_Provider, THE Bot SHALL include the Provider_Type, credential, and the guild's effective model (the Selected_Model when set, otherwise the Provider_Type's Default_Model) in the resolved authentication passed to the Runner.
2. WHEN the Runner receives a task for an OpenAI_Compatible_Provider, THE Runner SHALL execute the task against that provider using the effective model received in the resolved authentication.
3. IF the Runner cannot execute a task on the configured OpenAI_Compatible_Provider, THEN THE Bot SHALL mark the task as failed, SHALL post a user-facing message in the originating channel that names the configured Provider_Type and states that it could not run the task, and SHALL NOT persist any partial task result.
4. IF the Runner cannot execute a task on the configured OpenAI_Compatible_Provider, THEN THE Bot SHALL NOT execute or retry the task on a Provider_Type other than the configured one or on a model other than the guild's effective model.
5. WHEN the Task_Path resolves a credential for an Anthropic_Provider or `custom` provider, THE Bot SHALL preserve the existing task execution behavior.

### Requirement 8: Credential storage and confidentiality

**User Story:** As an admin, I want new-provider credentials protected exactly like the existing ones, so that connecting OpenAI or OpenRouter introduces no new exposure.

#### Acceptance Criteria

1. WHEN the Bot persists an OpenAI_Provider or OpenRouter_Provider credential, THE Credential_Store SHALL store the API key AES-256-GCM-encrypted per guild using the same scheme as existing providers.
2. THE Bot SHALL exclude every stored API key and authorization header value from all channel messages, ephemeral replies, and status output.
3. IF a stored credential cannot be decrypted, THEN THE Bot SHALL abort the dependent operation without using a partial or fallback credential, SHALL treat the guild as unconfigured, and SHALL report that the credential is unreadable and instruct the Admin to reconnect via `/connect llm`.
4. WHEN an Admin removes the guild credential, THE Bot SHALL clear the stored Provider_Type, credential, base URL, Selected_Model, and credential-set timestamp for that guild, and SHALL confirm to the Admin that the credential was removed.
5. IF a credential-removal operation does not clear all stored credential fields, THEN THE Bot SHALL retry the cleanup up to 3 additional times, clearing the Provider_Type, credential, base URL, Selected_Model, and credential-set timestamp for that guild.
6. IF cleanup still leaves any stored credential field set after the retry attempts, THEN THE Bot SHALL report that the credential removal was incomplete, SHALL instruct the Admin to retry, and SHALL treat the guild as unconfigured.

### Requirement 9: Status visibility for configured provider and model

**User Story:** As an admin, I want status output to show which provider and model my guild uses, so that I can confirm my configuration.

#### Acceptance Criteria

1. WHEN an Admin views connection status for a guild with a configured Provider_Type, THE Bot SHALL display the configured Provider_Type for the guild.
2. WHEN an Admin views connection status for a guild with a configured Provider_Type, THE Bot SHALL display the guild's effective model, being the Selected_Model when set and otherwise the Default_Model.
3. IF an Admin views connection status for a guild with no configured Provider_Type, THEN THE Bot SHALL display that no provider is configured.
4. WHERE a guild has a configured Provider_Type but neither a Selected_Model nor a Default_Model is available, THE Bot SHALL display an indicator that no model is configured.
5. THE Bot SHALL exclude all stored credential material, including the API key and any authorization header value, from all status output.
6. IF the Bot cannot retrieve the connection status for a guild, THEN THE Bot SHALL respond that the status could not be retrieved.

### Requirement 10: Reject unusable model selections

**User Story:** As an admin, I want to be told when a model identifier will not work, so that I do not leave my guild with a broken configuration.

#### Acceptance Criteria

1. IF an Admin submits a model identifier that is empty, whitespace-only, or exceeds 256 characters measured after trimming leading and trailing whitespace, THEN THE Bot SHALL reject the change and SHALL retain the previous Selected_Model.
2. WHERE the Bot validates a submitted model identifier against the configured provider within 10 seconds, IF the provider reports the model is unavailable to the credential, THEN THE Bot SHALL reject the change, SHALL retain the previous Selected_Model, and SHALL respond that the model is unavailable.
3. IF the provider does not respond within 10 seconds, or validation fails for a reason other than model unavailability, THEN THE Bot SHALL reject the change, SHALL retain the previous Selected_Model, and SHALL respond that the model could not be validated.
4. WHEN the Bot rejects a model change, THE Bot SHALL state the reason for the rejection in the response, regardless of whether the previous Selected_Model was successfully retained.
