# Implementation Plan: Multi-Provider Model Switching

## Overview

This plan implements the provider-adapter seam, OpenAI/OpenRouter connect flows, the
`/model` model-switcher, provider-scoped storage, status visibility, and the runner
translation-sidecar path described in the design. Implementation language is **TypeScript**
(matching the existing codebase).

The work is deliberately sequenced so the **Anthropic adapter is extracted verbatim and
locked behind a golden byte-for-byte backward-compatibility test before any behavior moves
through the new seam** — this guarantees `anthropic_api_key`, `claude_oauth`, and `custom`
remain unchanged (Req 6.3, 7.5). Foundation tasks (config keys, DB enum widening, shared
`llmAuthSchema`) land first, then the adapter seam, then the `credentials.ts`/`chat.ts`
refactor onto the seam, then the Connect_Flow + `/model` + status surfaces, then the runner
path. The cross-cutting secret-exclusion property runs last, after every output-producing
path exists.

Tests use **vitest** with **fast-check** (already the workspace's PBT library). The 20
correctness properties are each a single property-based test run at `numRuns: 100` with
`fetch`, the clock, and the DB store injected as fakes (no network, no real DB). Every
property test carries a comment `// Feature: multi-provider-model-switching, Property N: ...`.
Commands: `pnpm --filter @anywarecode/bot test`, `pnpm --filter @anywarecode/shared test`,
`pnpm --filter @anywarecode/runner test`, plus the matching `typecheck` scripts.

## Tasks

- [x] 1. Foundation: config keys, provider enum, shared task-spec schema
  - [x] 1.1 Add per-provider default-model config keys
    - In `apps/bot/src/config.ts` add `OPENAI_DEFAULT_MODEL` (default e.g. `gpt-4o-mini`) and `OPENROUTER_DEFAULT_MODEL` (default e.g. `openrouter/auto`) as zod string fields with sensible defaults; document both in `.env.example`
    - These back the per-provider `Default_Model` lookup used by `defaultModelFor`
    - _Requirements: 5.4_

  - [x] 1.2 Widen the provider enum and re-document `llmModel` semantics
    - In `packages/db/src/schema.ts` extend `llmProviderType` enum to `["claude_oauth", "anthropic_api_key", "custom", "openai", "openrouter"]`; update the `llmModel` column comment from "custom provider only" to "Selected_Model for every provider type"
    - Add a Drizzle migration that performs the additive enum widening (e.g. `ALTER TYPE ... ADD VALUE` or a text-column check widening) so existing rows and their `llmModel` values are preserved
    - _Requirements: 8.1, 5.5_

  - [x] 1.3 Extend the shared `llmAuthSchema` discriminated union
    - In `packages/shared/src/index.ts` add `openai` and `openrouter` members to `llmAuthSchema`, each with `token: z.string().min(1)` and `model: z.string().min(1)`; this flows into `taskSpecSchema.llmAuth` and `TaskSpec`
    - Preserve the existing members unchanged so old runners ignore unknown fields and a new runner only ever rejects an OpenAI-compatible task via preflight (never silently)
    - _Requirements: 7.1_

  - [x] 1.4 Write unit tests for config defaults and the shared schema
    - In `config.test.ts` assert `OPENAI_DEFAULT_MODEL` / `OPENROUTER_DEFAULT_MODEL` defaults load; in `packages/shared/src/protocol.test.ts` assert the new `openai`/`openrouter` `llmAuth` variants parse and that missing `token`/`model` is rejected
    - _Requirements: 5.4, 7.1_

- [x] 2. Provider adapter seam: types + Anthropic verbatim extraction + golden guard
  - [x] 2.1 Define the `ProviderAdapter` interface and shared seam types
    - Create `apps/bot/src/llm/providers/types.ts` exporting `ProviderAdapter` exactly as in the design (`endpoint`, `effectiveModel`, `buildClassifyBody`, `buildReplyBody`, `buildProbeBody`, `extractDecision`, `extractReplyText`, `isProviderErrorBody`, `parseRateLimitInfo`, and the model-availability helper `isModelUnavailable`)
    - Re-export the shared `ChatContext`, `IntentDecision`, `HeaderGet`, and `RateLimitInfo` types the seam consumes; no I/O in this module
    - _Requirements: 6.1, 6.2_

  - [x] 2.2 Implement `AnthropicAdapter` as a verbatim lift of today's code
    - Create `apps/bot/src/llm/providers/anthropic.ts` moving `buildAnthropicHeaders` (endpoint+headers for `anthropic_api_key`/`claude_oauth`/`custom`), `buildClassifyRequest` body, `findDecideBlock`+`intentDecisionSchema` (`extractDecision`), `extractReplyText`, the `{type:"error"}` soft-error check (`isProviderErrorBody`), and the existing `parseRateLimitInfo` header names — byte-for-byte, no behavior change
    - `effectiveModel` returns `auth.model` for `custom`, else the passed fallback model; `isModelUnavailable` maps a `400/404` unknown-model body to true
    - _Requirements: 6.3, 7.5_

  - [x] 2.3 Write the golden backward-compatibility test for `AnthropicAdapter`
    - In `apps/bot/src/llm/providers/anthropic.golden.test.ts` assert `AnthropicAdapter` produces byte-identical URL, headers, and classify/reply/probe request bodies to the pre-refactor `buildAnthropicHeaders`/`buildClassifyRequest`/probe for all three legacy auth types (snapshot fixtures captured from current code)
    - _Requirements: 6.3, 7.5_

  - [x] 2.4 Implement `defaults.ts` (`defaultModelFor` + shared `effectiveModel`)
    - Create `apps/bot/src/llm/providers/defaults.ts` with `defaultModelFor(type, cfg)` (openai→`OPENAI_DEFAULT_MODEL`, openrouter→`OPENROUTER_DEFAULT_MODEL`, custom→row model, else `DEFAULT_MODEL`) and the single `effectiveModel(guild|auth)` rule: trimmed stored model when non-empty, else `defaultModelFor`
    - _Requirements: 5.4_

  - [x] 2.5 Write property test for effective-model resolution
    - **Property 7: Effective-model resolution**
    - **Validates: Requirements 5.4**
    - Generate arbitrary provider type + nullable/whitespace/non-empty stored model; assert `effectiveModel` equals trimmed stored model when non-empty else the provider Default_Model; `numRuns: 100`

- [x] 3. OpenAI-compatible adapter and dispatch
  - [x] 3.1 Implement `OpenAiCompatibleAdapter`
    - Create `apps/bot/src/llm/providers/openai-compatible.ts` parameterized by base URL (`api.openai.com` vs `openrouter.ai/api`) covering `openai`/`openrouter`: Bearer auth header; classify body = forced `decide` function tool with system-as-first-message; reply body = plain completion; probe body = single user message with `max_tokens: 1`
    - `extractDecision` reads `choices[0].message.tool_calls[0].function.arguments`, guarded `JSON.parse`, validates against the shared `intentDecisionSchema`, returns `null` on any miss; `extractReplyText` reads `choices[0].message.content`; `isProviderErrorBody` returns `false` (status ladder governs); `parseRateLimitInfo` reads `x-ratelimit-*`/`retry-after`; `isModelUnavailable` maps a model-unknown `400/404` body to true
    - Reuse shared `renderContext`, `SYSTEM_PROMPT`, `intentDecisionSchema`, and the `decide` parameter schema — only the envelope differs
    - _Requirements: 6.1, 6.2_

  - [x] 3.2 Implement `adapterFor` dispatch
    - Create `apps/bot/src/llm/providers/index.ts` exporting `adapterFor(auth)` that returns `AnthropicAdapter` for `anthropic_api_key`/`claude_oauth`/`custom` and `OpenAiCompatibleAdapter` (correct base URL) for `openai`/`openrouter`
    - _Requirements: 6.1, 6.3_

  - [x] 3.3 Write property test for adapter request-shape construction
    - **Property 11: Each adapter builds its provider's request shape carrying the effective model**
    - **Validates: Requirements 6.1, 6.3**
    - Generate arbitrary chat context + effective model; assert OpenAI body is system-first + forced `decide` function tool and Anthropic body is top-level `system` + `decide` tool, each carrying the model; `numRuns: 100`

  - [x] 3.4 Write property test for reply extraction
    - **Property 12: Reply extraction reads the provider's response shape**
    - **Validates: Requirements 6.2**
    - Generate arbitrary successful bodies; assert OpenAI extracts `choices[0].message.content` and Anthropic joins `text` blocks; `numRuns: 100`

  - [x] 3.5 Write property test for classification routing equivalence
    - **Property 13: Classification routing equivalence across providers**
    - **Validates: Requirements 6.4**
    - Generate arbitrary valid `IntentDecision`, encode into an Anthropic `tool_use` body and an OpenAI `tool_calls` body, extract through each adapter, assert equal decisions; `numRuns: 100`

  - [x] 3.6 Write property test for malformed-classification fallback
    - **Property 14: Malformed classification response falls back to a reply**
    - **Validates: Requirements 6.5**
    - Generate empty/unparseable/decision-missing OpenAI bodies; assert `extractDecision` returns `null` and the classify path resolves to a reply, not a task launch; `numRuns: 100`

- [x] 4. Refactor `credentials.ts` onto the adapter seam
  - [x] 4.1 Extend the `LlmAuth` union and `resolveLlmAuth`
    - In `apps/bot/src/llm/credentials.ts` add the `openai`/`openrouter` `LlmAuth` variants `{ type, token, model }`; add `resolveLlmAuth` branches that decrypt the token and return `{ type, token, model: guild.llmModel ?? defaultModelFor(type) }`; keep decrypt-failure behavior (abort, treat unconfigured, instruct reconnect)
    - _Requirements: 7.1, 8.3_

  - [x] 4.2 Make `validateLlmAuth` adapter-driven
    - Rewrite `validateLlmAuth` to use `adapter.endpoint(auth)` + `adapter.buildProbeBody(effectiveModel)` under a 10s `AbortController`; map `401/403`→reject ("Authentication failed…"), `200`/`400`→ok, abort/timeout/transport→reject ("Connection failed…"); ensure reason strings never include the token or any auth header; accept an injectable `fetchFn`/clock
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 4.3 Write property test for the minimal validation request shape
    - **Property 3: Credential validation uses the minimal Chat Completions shape and gates persistence**
    - **Validates: Requirements 3.1**
    - `numRuns: 100` with an injected fetch capturing the issued request; assert exactly one minimal `/v1/chat/completions` payload and persistence only on success

  - [x] 4.4 Write property test for validation status classification
    - **Property 4: Validation status classification (auth-fail vs authenticated)**
    - **Validates: Requirements 3.3, 3.4**
    - Generate arbitrary statuses; assert `401/403`→reject/no-persist and `200`/`400`→accept/persist; `numRuns: 100`

  - [x] 4.5 Write property test for resolved task auth
    - **Property 16: Resolved task auth carries provider type, credential, and effective model**
    - **Validates: Requirements 7.1**
    - Generate arbitrary OpenAI-compatible guild rows; assert resolved auth carries the type, decrypted token, and effective model; `numRuns: 100`

  - [x] 4.6 Write property test for guild-bound encryption round-trip
    - **Property 18: Credential encryption round-trip is guild-bound**
    - **Validates: Requirements 8.1**
    - Generate arbitrary token + guild id; assert decrypt under same guild returns the token and decrypt under a different guild returns `null`; `numRuns: 100`

  - [x] 4.7 Write property test for undecryptable-credential handling
    - **Property 19: Undecryptable credential is treated as unconfigured**
    - **Validates: Requirements 8.3**
    - Generate arbitrary non-decryptable blobs; assert `resolveLlmAuth` returns `{ auth: null, reason }` instructing `/connect llm`, never a partial credential; `numRuns: 100`

  - [x] 4.8 Write unit test for the 10s validation timeout
    - With a never-resolving injected fetch, assert `validateLlmAuth` aborts at 10s and returns the connection-failed rejection
    - _Requirements: 3.2, 3.5_

- [x] 5. Refactor `chat.ts` direct calls onto the adapter seam
  - [x] 5.1 Route `buildClassifyRequest`/`classifyIntent`/`generateChatReply` through `adapterFor`
    - In `apps/bot/src/llm/chat.ts` replace direct `buildAnthropicHeaders` use with `const a = adapterFor(auth)`; build classify/reply bodies via the adapter, derive conformance from `a.extractDecision(body) !== null` and `a.extractReplyText(body).length > 0`, and pass `a.isProviderErrorBody` into `classifyResponse`; map a `null` decision on a 200 to `{ action: "reply", reply_text: <assistant content if any else safe default> }`; keep the 60s `CLASSIFIER_TIMEOUT_SECONDS` + `fetchWithTimeout` unchanged
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.7_

  - [x] 5.2 Write property test for failure-mode mapping
    - **Property 15: Non-success responses map to an existing failure-mode message**
    - **Validates: Requirements 6.6**
    - Generate arbitrary non-success statuses; assert classification yields exactly one of the five `FailureMode` categories and the message-builder returns that category's non-empty existing copy; `numRuns: 100`

  - [x] 5.3 Write unit test for the 60s classify timeout
    - With a never-resolving injected fetch, assert `classifyIntent` stops at 60s and surfaces the existing failure-mode messaging without launching a task
    - _Requirements: 6.7_

- [x] 6. Checkpoint — adapter seam and direct-call refactor
  - Ensure all tests pass (including the golden backward-compat guard and adapter property tests), ask the user if questions arise.

- [x] 7. Connect_Flow for OpenAI and OpenRouter (`connect.ts`)
  - [x] 7.1 Add provider buttons and credential modals
    - In `apps/bot/src/discord/connect.ts` add `aw:llm:openai` and `aw:llm:openrouter` buttons to `llmChooserMessage`, and register two modal builders in `handleLlmButton`: OpenAI (key 1–512 chars, model 0–256 chars) and OpenRouter (key ≤512, model ≤200); add `openai`/`openrouter` to `providerTypeLabel`
    - _Requirements: 1.1, 1.2, 2.1, 2.2_

  - [x] 7.2 Add `handleLlmModal` persistence branches
    - Add `openai`/`openrouter` branches that build the new `LlmAuth` variants, validate via `validateLlmAuth` (Req 3), and on success persist `llmProviderType`, encrypted `llmCredentialEnc`, `llmModel = trimmedModel || defaultModelFor(type)`, `llmBaseUrl = null`, and `llmCredentialSetAt = now` (from an injectable clock); reject a whitespace-only OpenRouter/OpenAI key at submit with an "API key is required" message and no persistence
    - _Requirements: 1.3, 1.4, 1.6, 2.3, 2.4, 2.6, 2.7, 5.5_

  - [x] 7.3 Implement bounded-retry credential removal
    - Change the remove path to clear `{llmProviderType, llmCredentialEnc, llmBaseUrl, llmModel, llmCredentialSetAt}`, re-read the row, and retry the clear up to 3 additional times (4 total) if any field remains set; on success confirm removal, on exhaustion report the removal was incomplete and treat the guild as unconfigured
    - _Requirements: 8.4, 8.5, 8.6_

  - [x] 7.4 Write property test for connect persistence
    - **Property 1: Connect persists the submitted-or-default model, overwriting any prior**
    - **Validates: Requirements 1.3, 1.6, 2.3, 2.6, 5.5**
    - Generate arbitrary prior state, provider type, and submitted model; assert stored `llmModel` is the trimmed submission when non-empty else the provider Default_Model (never the prior model) and `llmProviderType` is the chosen type; `numRuns: 100`

  - [x] 7.5 Write property test for whitespace-only key rejection
    - **Property 2: Whitespace-only API key is rejected with no persistence**
    - **Validates: Requirements 2.7**
    - Generate all-whitespace keys; assert rejection, no credential field persisted, and an "API key is required" message; `numRuns: 100`

  - [x] 7.6 Write property test for bounded-retry removal
    - **Property 20: Bounded-retry credential removal**
    - **Validates: Requirements 8.4, 8.5, 8.6**
    - With an injected store that stays dirty for up to 3 attempts then succeeds, assert all five fields cleared within ≤4 attempts and removal confirmed; with an always-dirty store, assert it stops after 4 attempts, reports incomplete, and treats the guild as unconfigured; `numRuns: 100`

  - [x] 7.7 Write unit tests for chooser, modal limits, gating, and timestamp
    - Assert chooser includes OpenAI/OpenRouter options (1.1, 2.1); modal field length limits (1.2, 2.2); non-admin connect rejected ephemerally with no modal/persistence (1.5, 2.5); credential-set timestamp written from an injected clock (1.4, 2.4)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.4, 2.5_

- [x] 8. Model_Selector `/model` command (`apps/bot/src/discord/model.ts`)
  - [x] 8.1 Implement the `/model` handler, change-modal, and probe validation
    - Create `apps/bot/src/discord/model.ts`: admin-gated handler that with no option shows an ephemeral status (configured provider + effective model + "Change model" button) or instructs `/connect llm` when unconfigured; the change modal collects one model field (1–200 chars). On submit: trim and reject empty/whitespace or >256 chars (retain previous, state reason); validate via `probeModel` (adapter-aware) under a 10s timeout; on model-unavailable signal reject with "model is unavailable", on timeout/other failure reject with "could not be validated"; on success write `llmModel` only (leave provider/credential/timestamp untouched) and confirm by naming the new model; non-admin invocation rejected with no state change; no tier/paywall/cap checks
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.6, 10.1, 10.2, 10.3, 10.4_

  - [x] 8.2 Register `/model` and wire button/modal dispatch
    - Add the `/model` builder in `commands.ts` with `setDefaultMemberPermissions(ManageGuild)` and an optional model option; add `case "model"` dispatch in `interactions.ts`; route the `aw:model:*` button and `aw:model_modal` submit to the new handler
    - _Requirements: 4.1_

  - [x] 8.3 Write property test for provider-scoped model mutation
    - **Property 6: Model switch is provider-scoped and mutates only the Selected_Model**
    - **Validates: Requirements 4.2, 5.1, 5.2, 5.3**
    - Generate arbitrary configured state + accepted model; assert only `llmModel` changes and provider/credential/baseUrl/timestamp are untouched; `numRuns: 100`

  - [x] 8.4 Write property test for confirmation naming
    - **Property 8: Confirmation names the new model**
    - **Validates: Requirements 4.5**
    - Generate arbitrary accepted identifiers; assert the success response contains the trimmed persisted model; `numRuns: 100`

  - [x] 8.5 Write property test for invalid-model rejection
    - **Property 9: Syntactically invalid model is rejected and the previous selection retained**
    - **Validates: Requirements 5.6, 10.1, 10.4**
    - Generate empty/whitespace/>256-char identifiers; assert rejection with stored model unchanged and a reason stated; `numRuns: 100`

  - [x] 8.6 Write property test for provider-reported unavailable model
    - **Property 10: Provider-reported unavailable model is rejected with the unavailable reason**
    - **Validates: Requirements 10.2**
    - With an injected probe reporting unavailable within the limit, assert rejection, previous model retained, and an "unavailable" response; `numRuns: 100`

  - [x] 8.7 Write unit tests for gating, unconfigured, validation timeout, and no-cap
    - Assert non-admin `/model` rejected with no state change (4.4); unconfigured guild instructs reconnect (4.3); a never-resolving probe yields "could not be validated" at 10s (10.3); no billing/cap check applied (4.6)
    - _Requirements: 4.3, 4.4, 4.6, 10.3_

- [x] 9. Status visibility (`connect.ts` setup + `llm-status.ts`)
  - [x] 9.1 Render provider + effective model in setup and `/llm-status`
    - Update `handleSetupCommand` (in `connect.ts`) and `handleLlmStatusCommand` (in `llm-status.ts`) to show `providerTypeLabel(llmProviderType)` plus the effective model (`llmModel ?? defaultModelFor(type)`), "no model configured" when neither exists, "no provider configured" when unconfigured, and a "status could not be retrieved" path on decrypt/read failure (treating the guild as unconfigured); ensure no credential material appears in any status output
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 8.3_

  - [x] 9.2 Write unit tests for status rendering
    - Assert each rendering case: provider+effective-model shown, no-provider, no-model-configured, and could-not-retrieve on a decrypt/read failure
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6_

- [x] 10. Runner path: credential wiring, preflight, translation sidecar, clear failure
  - [x] 10.3 Implement the Messages↔Chat-Completions translator module
    - Add `apps/runner/src/translator.ts` (and bundle it in the runner `Dockerfile`): a localhost sidecar presenting an Anthropic-Messages endpoint that forwards to the provider's Chat Completions API, mapping `tool_use`/`tool_result` to function calls and back; expose a `startTranslator()` returning the bound `127.0.0.1:<port>` URL
    - _Requirements: 7.2_

  - [x] 10.1 Add `openai`/`openrouter` credential-wiring arms in runner `index.ts`
    - In `apps/runner/src/index.ts` add switch arms for `openai`/`openrouter` that start the translator (10.3) and set `ANTHROPIC_BASE_URL = <translator url>`, `ANTHROPIC_AUTH_TOKEN = <provider key>`, `ANTHROPIC_MODEL = <effective model>`, leaving `ClaudeAgent` unchanged; keep the existing `anthropic_api_key`/`claude_oauth`/`custom` arms byte-for-byte
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 10.2 Add `openai`/`openrouter` preflight arms
    - In `apps/runner/src/preflight.ts` add arms asserting the translator base URL and `ANTHROPIC_MODEL` are set and the model id is well-formed, skipping the `claude-` first-party check for these types; on failure (or translator unreachable) produce a clear problem string
    - _Requirements: 7.2, 7.3_

  - [x] 10.4 Implement provider-named clear-failure on the bot task path
    - In the bot's task-launch/failure path (`launch.ts`/orchestrator) ensure a runner preflight/translator failure marks the task failed, posts a channel message naming the configured Provider_Type ("Couldn't run this task on your configured **OpenAI** provider…"), persists no partial result, and never retries on another provider or model
    - _Requirements: 7.3, 7.4_

  - [x] 10.5 Write property test for unrunnable-task failure messaging
    - **Property 17: Unrunnable OpenAI-compatible task names the provider and persists nothing**
    - **Validates: Requirements 7.3**
    - Generate arbitrary OpenAI-compatible provider types; assert the user-facing failure names that provider and no partial result is persisted; `numRuns: 100`

  - [x] 10.6 Write integration tests for the translation sidecar
    - Three representative runs through `apps/runner`: one OpenAI, one OpenRouter (verify base-URL/model wiring reaches `ClaudeAgent`), and one translator-down asserting the clear-failure path with no cross-provider/model retry
    - _Requirements: 7.2, 7.4_

  - [x] 10.7 Write golden test for unchanged Anthropic/`custom` env wiring
    - Assert the runner credential-env switch for `anthropic_api_key`/`claude_oauth`/`custom` is a byte-for-byte match to today (no behavior drift)
    - _Requirements: 7.5_

- [x] 11. Cross-cutting confidentiality guard
  - [x] 11.1 Write the secret-exclusion property test across all output paths
    - **Property 5: Secret-exclusion invariant across all user-facing output**
    - **Validates: Requirements 3.6, 8.2, 9.5**
    - Generate a token, drive every output-producing path (validation responses, chat-path and task-path failure messages, Model_Selector responses, status output) and assert neither the raw token nor its `Bearer <token>` form appears in any returned string; `numRuns: 100`

- [x] 12. Final checkpoint — verify the full feature
  - Run `pnpm --filter @anywarecode/shared typecheck && pnpm --filter @anywarecode/shared test`, `pnpm --filter @anywarecode/bot typecheck && pnpm --filter @anywarecode/bot test`, and `pnpm --filter @anywarecode/runner typecheck && pnpm --filter @anywarecode/runner test`; ensure all tests pass, treating the golden backward-compat guards (2.3, 10.7) and the secret-exclusion property (11.1) as release-blocking. Ensure all tests pass, ask the user if questions arise.

## Notes

- Implementation language is **TypeScript**; the design used concrete TypeScript so no language selection was required.
- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation sub-tasks are never optional.
- The Anthropic adapter is extracted verbatim (2.2) and locked by a golden byte-for-byte test (2.3) **before** any code routes through the seam, guaranteeing no regression for `anthropic_api_key`/`claude_oauth`/`custom` (Req 6.3, 7.5).
- Each of the 20 correctness properties is its own sub-task placed next to the code it validates, annotated with its property number and the requirement clauses it checks, and runs at `numRuns: 100` with injected `fetch`/clock/store.
- Example, integration, and golden tests cover the UI-rendering, timeout, authorization-gate, and runner-integration criteria classified as non-properties in the design Testing Strategy.
- All context documents (requirements.md, design.md) are assumed available during implementation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1", "10.3"] },
    { "id": 1, "tasks": ["1.4", "2.2", "2.4", "3.1", "10.2"] },
    { "id": 2, "tasks": ["2.3", "2.5", "3.2", "10.1"] },
    { "id": 3, "tasks": ["3.3", "3.4", "3.5", "3.6", "4.1", "10.4"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "7.1", "10.5", "10.6", "10.7"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3"] },
    { "id": 9, "tasks": ["9.1", "8.1"] },
    { "id": 10, "tasks": ["7.4", "7.5", "7.6", "7.7", "8.2", "9.2"] },
    { "id": 11, "tasks": ["8.3", "8.4", "8.5", "8.6", "8.7"] },
    { "id": 12, "tasks": ["11.1"] }
  ]
}
```
