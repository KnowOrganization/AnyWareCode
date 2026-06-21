# Requirements Document

## Introduction

AnyWareCode is a Discord-based coding-agent bot where each guild brings its own LLM credential (BYO-LLM). When a guild's Anthropic credential is throttled, the bot currently appears "completely broken": @mentions, questions, and code/ask task launches all return a vague "Sorry, I couldn't generate a response. Please try again later."

Live diagnosis confirmed the underlying cause is recoverable and explainable: the connected guild uses a Claude Pro/Max subscription token (`claude_oauth`) whose usage cap is exhausted on heavier model tiers. With the same token, `claude-haiku-4-5` returns HTTP 200 while `claude-sonnet-4-6` and `claude-opus-4-8` return HTTP 429 `rate_limit_error`. The cheap classifier call (Haiku / `CHAT_MODEL`) succeeds, but the actual reply (`DEFAULT_MODEL` / Sonnet) and task launches (`CODE_MODEL` / Opus) fail with 429. Today's code in `apps/bot/src/llm/chat.ts` swallows every non-200 into a generic string and `classifyIntent` silently falls back to a generic reply decision, so a throttled-but-recoverable subscription looks like a total outage.

This feature makes the bot resilient and transparent under Anthropic rate-limit / usage-cap (429) conditions and other distinct LLM failure modes, across both the bot-side chat/mention path and task launches (ask/code). It adds failure-mode classification, actionable user-facing messages that explain what happened and when recovery is expected, optional model-tier fallback, observability, and retry/backoff semantics — while preserving existing safety rules (never ping `@everyone`/`@here`, treat conversation content as untrusted).

## Glossary

- **Bot**: The AnyWareCode Discord bot process (`apps/bot`), which talks to the Anthropic Messages API directly only for mention classification and chat replies.
- **LLM_Provider**: The upstream Anthropic-compatible Messages API endpoint addressed by a guild's credential. Provider types are `anthropic_api_key`, `claude_oauth` (Claude Pro/Max subscription token), and `custom`.
- **Failure_Classifier**: The Bot component that maps an LLM_Provider HTTP response or transport error into exactly one Failure_Mode.
- **Failure_Mode**: One of a fixed set of categories describing why an LLM call did not succeed: `rate_limited`, `auth_failed`, `overloaded`, `model_error`, `network_error`.
- **Rate_Limit_Info**: Recovery metadata extracted from an LLM_Provider 429 response, derived from the `anthropic-ratelimit-unified-reset` header (epoch seconds), the `anthropic-ratelimit-unified-status` header, and/or the `retry-after` header.
- **Reset_Time**: The wall-clock time at which a rate-limited credential is expected to recover, derived from Rate_Limit_Info.
- **Chat_Path**: The bot-side mention flow (`handleMention`, `classifyIntent`, `generateChatReply`) that responds to `@mentions`.
- **Task_Path**: The task-launch flow (`assertLlmUsable`, `checkTaskPreconditions`, `launchTask`) for `/ask` and `/code` work.
- **Model_Tier**: A named Anthropic model used by the Bot: Haiku (`CHAT_MODEL`, lightest), Sonnet (`DEFAULT_MODEL`, mid), Opus (`CODE_MODEL`, heaviest).
- **Fallback_Model**: A configured lighter Model_Tier the Bot may use when the requested heavier Model_Tier is rate-limited.
- **User_Message**: The Discord message the Bot posts back to users, governed by existing safety rules (no `@everyone`/`@here`/role/user mention syntax; replies only ping the replied user).
- **Admin**: A Discord guild member with permission to run configuration commands such as `/connect llm`.
- **Structured_Log**: A `pino`-based log entry emitted through the Bot's observability module, optionally forwarded to Sentry.

## Requirements

### Requirement 1: Classify LLM API failure modes distinctly

**User Story:** As a developer using the bot, I want LLM failures to be distinguished by cause, so that the bot can respond appropriately to each situation instead of treating everything as a generic outage.

#### Acceptance Criteria

1. WHEN an LLM_Provider call returns HTTP 429, THE Failure_Classifier SHALL classify the result as Failure_Mode `rate_limited`.
2. WHEN an LLM_Provider call returns HTTP 401 or HTTP 403, THE Failure_Classifier SHALL classify the result as Failure_Mode `auth_failed`.
3. WHEN an LLM_Provider call returns HTTP 529, THE Failure_Classifier SHALL classify the result as Failure_Mode `overloaded`.
4. WHEN an LLM_Provider call returns an HTTP status in the range 500 to 599 other than 529, THE Failure_Classifier SHALL classify the result as Failure_Mode `overloaded`.
5. WHEN an LLM_Provider call returns an HTTP status in the range 400 to 499 other than 401, 403, and 429, THE Failure_Classifier SHALL classify the result as Failure_Mode `model_error`.
6. WHEN an LLM_Provider call returns HTTP 200 with a conformant response body, THE Failure_Classifier SHALL classify the result as success with no Failure_Mode.
7. WHEN an LLM_Provider call returns HTTP 200 with a non-conformant response body or a provider error indicator, THE Failure_Classifier SHALL classify the result as Failure_Mode `model_error`.
8. IF an LLM_Provider call returns an HTTP status that is received but does not match any other acceptance criterion in this requirement, THEN THE Failure_Classifier SHALL classify the result as Failure_Mode `model_error`.
9. IF an LLM_Provider call fails to complete due to a transport-level error before an HTTP status is received, including connection-refused, connection-reset, DNS-resolution failure, TLS-handshake failure, or a no-response timeout after a configurable duration defaulting to 60 seconds, THEN THE Failure_Classifier SHALL classify the result as Failure_Mode `network_error`.
10. THE Failure_Classifier SHALL classify each LLM_Provider result as exactly one of success or one of the five Failure_Modes `rate_limited`, `auth_failed`, `overloaded`, `model_error`, and `network_error`, which are mutually exclusive and collectively exhaustive.

### Requirement 2: Extract rate-limit recovery metadata

**User Story:** As a developer, I want the bot to read the rate-limit reset information from the API response, so that it can tell me when service will recover.

#### Acceptance Criteria

1. WHEN a response is classified as `rate_limited` AND the response includes an `anthropic-ratelimit-unified-reset` header whose value is a valid non-negative integer, THE Failure_Classifier SHALL derive Reset_Time from the `anthropic-ratelimit-unified-reset` header value interpreted as epoch seconds.
2. IF a response is classified as `rate_limited` AND the `anthropic-ratelimit-unified-reset` header is absent or its value is not a valid non-negative integer, THEN THE Failure_Classifier SHALL treat the `anthropic-ratelimit-unified-reset` header as absent and fall through to the `retry-after` header.
3. WHEN a response is classified as `rate_limited` AND the `anthropic-ratelimit-unified-reset` header is treated as absent AND the `retry-after` header is present with a valid non-negative integer value, THE Failure_Classifier SHALL bound the `retry-after` value to the range 0 to 86400 seconds and derive Reset_Time by adding the bounded `retry-after` value in seconds to the time the response was received.
4. WHERE the `anthropic-ratelimit-unified-status` header is present on a rate-limited response, THE Failure_Classifier SHALL include the `anthropic-ratelimit-unified-status` value, capped at 256 characters, in the Rate_Limit_Info.
5. IF a response is classified as `rate_limited` AND neither a usable `anthropic-ratelimit-unified-reset` header value nor a usable `retry-after` header value is present, THEN THE Failure_Classifier SHALL produce Rate_Limit_Info with no Reset_Time.
6. IF a response is classified as `rate_limited` AND the derived Reset_Time is earlier than the time the response was received, THEN THE Failure_Classifier SHALL clamp Reset_Time to the time the response was received.

### Requirement 3: Surface actionable rate-limit messages on the chat path

**User Story:** As a user who @mentions the bot, I want a clear explanation when the bot is rate-limited, so that I know what happened and when to try again instead of seeing a vague error.

#### Acceptance Criteria

1. WHEN the Chat_Path reply generation is classified as `rate_limited` AND no Fallback_Model attempt succeeds, THE Bot SHALL post a User_Message stating that the connected LLM credential has hit its usage or rate limit.
2. WHEN the Chat_Path posts a rate-limit User_Message AND a Reset_Time is available, THE Bot SHALL include the Reset_Time in the User_Message rendered as both an absolute calendar date-and-time and a relative duration until recovery, each displayed unambiguously regardless of the viewing user's local timezone.
3. IF the Chat_Path posts a rate-limit User_Message AND no Reset_Time is available, THEN THE Bot SHALL state in the User_Message that the recovery time is unknown and that the user should retry after the credential's usage window resets.
4. THE Bot SHALL exclude `@everyone`, `@here`, and any user or role mention syntax from every rate-limit User_Message.
5. WHEN the Bot posts any rate-limit User_Message as a reply, THE Bot SHALL restrict allowed mentions so that only the replied user is pinged.
6. IF a rate-limit User_Message would exceed 2000 characters, THEN THE Bot SHALL truncate it to at most 2000 characters while preserving the statement that the credential hit its usage or rate limit and, when present, the Reset_Time.

### Requirement 4: Surface actionable failure messages for non-rate-limit modes on the chat path

**User Story:** As a user who @mentions the bot, I want distinct messages for auth, overload, and other failures, so that I can tell whether the problem is recoverable on its own or needs an admin.

#### Acceptance Criteria

1. WHEN the Chat_Path reply generation is classified as `auth_failed`, THE Bot SHALL post a User_Message stating that the LLM credential is invalid and that an Admin needs to run `/connect llm` to restore service.
2. WHEN the Chat_Path reply generation is classified as `overloaded`, THE Bot SHALL post a User_Message stating that the LLM_Provider is temporarily overloaded and suggesting the user retry after at least 30 seconds.
3. WHEN the Chat_Path reply generation is classified as `model_error`, THE Bot SHALL post a User_Message stating that the request could not be processed by the selected model and that retrying the same request unchanged is unlikely to succeed.
4. WHEN the Chat_Path reply generation is classified as `network_error`, THE Bot SHALL post a User_Message stating that the LLM_Provider could not be reached and suggesting the user retry after at least 30 seconds.
5. WHEN the Chat_Path reply generation is classified as any one non-success Failure_Mode, THE Bot SHALL post exactly one failure User_Message corresponding to that Failure_Mode.
6. THE Bot SHALL exclude `@everyone`, `@here`, and any user or role mention syntax from every failure User_Message described in this requirement.
7. WHEN the Bot posts any failure User_Message described in this requirement as a reply, THE Bot SHALL restrict allowed mentions so that only the replied user is pinged.

### Requirement 5: Surface actionable failure messages on the task-launch path

**User Story:** As a user assigning an `/ask` or `/code` task, I want the bot to explain when the task cannot start because of an LLM limit, so that I do not interpret a throttled credential as a broken bot.

#### Acceptance Criteria

1. WHEN a Task_Path launch cannot proceed because the required Model_Tier Opus (`CODE_MODEL`) is classified as `rate_limited`, THE Bot SHALL post a User_Message stating that the credential has hit its usage or rate limit on the required model.
2. WHEN the Task_Path posts a rate-limit User_Message AND a Reset_Time is available, THE Bot SHALL include the Reset_Time rendered as an absolute wall-clock date and time in the User_Message.
3. IF the Task_Path posts a rate-limit User_Message AND no Reset_Time is available, THEN THE Bot SHALL state in the User_Message that the recovery time is unknown and that the user should retry after the credential's usage window resets.
4. WHEN a Task_Path launch cannot proceed because the LLM call is classified as `auth_failed`, THE Bot SHALL post a User_Message stating that the credential is invalid and that an Admin needs to run `/connect llm`.
5. WHEN a Task_Path launch cannot proceed because the LLM call is classified as `overloaded` or `network_error`, THE Bot SHALL post a User_Message that names the corresponding Failure_Mode and suggests a retry.
6. WHEN a Task_Path launch cannot proceed because the LLM call is classified as `model_error`, THE Bot SHALL post a User_Message stating that the request could not be processed by the required model and that retrying the same request unchanged is unlikely to succeed.
7. IF a Task_Path launch is classified as any non-success Failure_Mode, THEN THE Bot SHALL NOT start the runner container and SHALL NOT create any task work or task row.
8. THE Bot SHALL exclude `@everyone`, `@here`, and any user or role mention syntax from every Task_Path failure User_Message.

### Requirement 6: Optional model-tier fallback on the chat path

**User Story:** As an Admin, I want chat to keep working on a lighter model when a heavier tier is rate-limited, so that the bot stays usable during partial throttling.

#### Acceptance Criteria

1. THE Bot SHALL expose a configuration flag, defaulting to disabled, that enables or disables Model_Tier fallback for the Chat_Path.
2. THE Bot SHALL expose a configuration value that names the Fallback_Model used when fallback is enabled.
3. WHERE Chat_Path fallback is enabled AND a Fallback_Model distinct from the requested Model_Tier is configured AND the requested Model_Tier reply is classified as `rate_limited`, THE Bot SHALL retry the reply exactly once using the Fallback_Model.
4. WHEN a Chat_Path reply succeeds using the Fallback_Model after the requested Model_Tier was classified as `rate_limited`, THE Bot SHALL include in the User_Message a notice stating that the reply was produced by a lighter model due to rate limits, excluding `@everyone`, `@here`, and any user or role mention syntax.
5. WHERE Chat_Path fallback is disabled, THE Bot SHALL post the rate-limit User_Message described in Requirement 3 without attempting a Fallback_Model.
6. IF the Fallback_Model attempt is also classified as `rate_limited`, THEN THE Bot SHALL post the rate-limit User_Message described in Requirement 3.
7. IF Chat_Path fallback is enabled AND no configured Fallback_Model distinct from the requested Model_Tier is available, THEN THE Bot SHALL post the rate-limit User_Message described in Requirement 3 without attempting a Fallback_Model.

### Requirement 7: Provider-type-aware messaging

**User Story:** As a user, I want failure messages to reflect which kind of credential the guild connected, so that subscription-specific behavior is understandable.

#### Acceptance Criteria

1. WHERE the connected provider type is `claude_oauth`, WHEN a Chat_Path reply or a Task_Path launch is classified as `rate_limited`, THE Bot SHALL include in the rate-limit User_Message text stating that subscription credentials exhaust heavier Model_Tiers before lighter Model_Tiers.
2. WHERE the connected provider type is `anthropic_api_key`, WHEN a Chat_Path reply or a Task_Path launch is classified as `rate_limited`, THE Bot SHALL post a rate-limit User_Message that excludes any subscription-specific text.
3. WHERE the connected provider type is `custom`, WHEN a Chat_Path reply or a Task_Path launch is classified as `rate_limited` or any other non-success Failure_Mode, THE Bot SHALL post a User_Message that references the configured custom model name and that excludes any named Anthropic Model_Tier.
4. IF the connected provider type is `custom` AND no custom model name is configured, THEN THE Bot SHALL post the corresponding rate-limit or failure User_Message that refers to the connected credential generically and that excludes any named Anthropic Model_Tier.
5. IF the connected provider type cannot be determined for the guild, THEN THE Bot SHALL post the corresponding rate-limit or failure User_Message that excludes provider-specific and subscription-specific text.

### Requirement 8: Coherent handling when classify succeeds but reply is rate-limited

**User Story:** As a user, I want a single coherent message when the classifier works but the reply model is throttled, so that I am not shown a misleading generic fallback.

#### Acceptance Criteria

1. WHEN `classifyIntent` succeeds on `CHAT_MODEL` AND the subsequent reply generation on the requested Model_Tier is classified as `rate_limited` AND no Fallback_Model produces a reply, THE Bot SHALL post exactly one rate-limit User_Message as described in Requirement 3.
2. IF `classifyIntent` succeeds on `CHAT_MODEL` AND the subsequent reply generation on the requested Model_Tier is classified as `rate_limited` AND no Fallback_Model produces a reply, THEN THE Bot SHALL NOT post the generic "couldn't generate a response" text.
3. IF `classifyIntent` is classified as `rate_limited`, THEN THE Bot SHALL post the rate-limit User_Message described in Requirement 3 AND SHALL NOT proceed to reply generation AND SHALL NOT post the generic "couldn't generate a response" text.
4. IF `classifyIntent` is classified as a non-success Failure_Mode other than `rate_limited`, THEN THE Bot SHALL post the failure User_Message described in Requirement 4 corresponding to that Failure_Mode AND SHALL NOT proceed to reply generation AND SHALL NOT post the generic "couldn't generate a response" text.
5. WHEN `classifyIntent` succeeds on `CHAT_MODEL` AND the subsequent reply generation is classified as `auth_failed`, `overloaded`, `model_error`, or `network_error`, THE Bot SHALL post the failure User_Message described in Requirement 4 corresponding to that Failure_Mode rather than the generic "couldn't generate a response" text.
6. WHEN a mention is classified as an `ask` or `code` action AND the Task_Path cannot start because the required Model_Tier is classified as `rate_limited`, THE Bot SHALL post exactly one Task_Path rate-limit User_Message as described in Requirement 5 AND SHALL NOT propose or launch the task AND SHALL NOT post the generic "couldn't generate a response" text.

### Requirement 9: Retry and backoff semantics

**User Story:** As an Admin, I want the bot to avoid hammering a throttled credential, so that repeated calls do not worsen the rate limit.

#### Acceptance Criteria

1. WHEN an LLM call is classified as `rate_limited`, THE Bot SHALL make at most one additional retry attempt for that LLM call within the triggering user action, counted independently per LLM call.
2. WHERE Rate_Limit_Info contains a `retry-after` value AND the Bot performs a retry, THE Bot SHALL wait at least the `retry-after` duration, interpreted in seconds, before issuing the retry.
3. WHERE the Bot performs a retry AND Rate_Limit_Info contains no `retry-after` value, THE Bot SHALL issue the retry without adding an additional wait delay.
4. IF a retry would require waiting longer than the configured maximum retry delay (default 5 seconds, configurable within the range 0 to 30 seconds), THEN THE Bot SHALL skip the retry and post the corresponding rate-limit User_Message.
5. WHEN an LLM call is classified as `auth_failed` or `model_error`, THE Bot SHALL NOT retry the call.
6. WHEN an LLM call is classified as `overloaded` or `network_error`, THE Bot SHALL NOT automatically retry the call within the same triggering user action.

### Requirement 10: Observability of LLM failures

**User Story:** As an operator, I want structured logs of LLM failures, so that I can diagnose throttling and outages without leaking secrets.

#### Acceptance Criteria

1. WHEN an LLM call is classified as a non-success Failure_Mode, THE Bot SHALL emit, at the time the call is classified, a Structured_Log entry containing the Failure_Mode and the requested Model_Tier.
2. WHEN an LLM call is classified as a non-success Failure_Mode AND an HTTP status was received, THE Bot SHALL include the HTTP status in the Structured_Log entry.
3. WHEN a Structured_Log entry is emitted for a `rate_limited` Failure_Mode AND a Reset_Time is available, THE Bot SHALL include the Reset_Time in the Structured_Log entry.
4. WHEN an LLM call is classified as a non-success Failure_Mode, THE Bot SHALL emit exactly one Structured_Log entry for that classified failure.
5. THE Bot SHALL emit every Structured_Log entry related to an LLM failure such that the entry does not contain the guild credential token or any authorization header value as a substring.
6. WHEN a Structured_Log entry is emitted for an LLM failure, THE Bot SHALL include the guild identifier and the provider type in the entry.

### Requirement 11: Admin LLM status visibility

**User Story:** As an Admin, I want to check the current LLM status, so that I can confirm whether the credential is healthy or rate-limited without parsing logs.

#### Acceptance Criteria

1. WHEN an Admin requests LLM status, THE Bot SHALL report the connected provider type for the guild in which the request was made.
2. WHEN an Admin requests LLM status, THE Bot SHALL probe each configured Model_Tier with a per-probe timeout of 10 seconds and report, for each Model_Tier, whether the most recent probe was classified as success or a specific Failure_Mode.
3. WHERE a probed Model_Tier is classified as `rate_limited` AND a Reset_Time is available, THE Bot SHALL include the Reset_Time rendered as a human-friendly time in the status report.
4. IF a guild member without Admin permission requests LLM status, THEN THE Bot SHALL deny the request, post a User_Message stating that Admin permission is required, and SHALL NOT probe any Model_Tier.
5. WHILE a previous LLM status probe for the same guild completed less than 60 seconds ago, THE Bot SHALL report the most recent probe results without issuing new probes.
6. THE Bot SHALL exclude the guild credential token and any authorization header value from the status report.
