# Implementation Plan: LLM Rate-Limit Resilience

## Overview

This plan implements failure-mode classification, actionable user-facing messaging, optional model-tier fallback, bounded retry/backoff, structured observability, and an admin `/llm-status` command for the AnyWareCode bot's LLM calls.

The work is sequenced so the pure leaf modules (`failures.ts`, `messages.ts`, `retry.ts`) and their property-based tests land first, followed by the `chat.ts` refactor, config additions, the `handleMention` rewrite with fallback, the Task_Path preflight probe, the `/llm-status` command with registration, and finally end-to-end wiring and verification.

Tests use **vitest** (`pnpm --filter @anywarecode/bot test`) and **fast-check** (added as a dev dependency) for the 16 property-based tests. Every property test carries a comment in the form `// Feature: llm-rate-limit-resilience, Property N: ...` and runs at least 100 iterations via `fc.assert(..., { numRuns: 100 })`.

## Tasks

- [x] 1. Project setup: test library and shared failure types
  - [x] 1.1 Add `fast-check` dev dependency to the bot package
    - Add `fast-check` to `devDependencies` in `apps/bot/package.json`
    - Run the workspace install so the dependency resolves before writing property tests
    - _Requirements: 1.10 (testing infrastructure for classifier/messages/retry properties)_

  - [x] 1.2 Define shared failure data models in `apps/bot/src/llm/failures.ts`
    - Create `failures.ts` and export `FailureMode`, `RateLimitInfo`, `LlmFailure`, `LlmCallResult`, and `FailureLogFields` exactly as specified in the design Data Models section
    - Export the supporting `ClassifyClock` and `HeaderGet` types used by the classifier signatures
    - No I/O, no Discord, no DB imports in this module
    - _Requirements: 1.10, 2.4, 2.5, 2.6, 10.1, 10.2, 10.3, 10.6_

- [x] 2. Implement the pure Failure_Classifier and rate-limit parser (`failures.ts`)
  - [x] 2.1 Implement `classifyResponse` and `classifyTransportError`
    - Implement the total status→mode `if/else if` ladder over disjoint ranges per the design mapping table (429→`rate_limited`, 401/403→`auth_failed`, 529 and 500–599→`overloaded`, 400–499 except 401/403/429→`model_error`, 200+conformant→success, 200+non-conformant or `{type:"error"}`→`model_error`, any other received status→`model_error`) with an unconditional final `model_error` arm
    - Accept a `validate: (body) => boolean` predicate so the classify path checks for a `decide` tool_use block and the reply path checks for a non-empty text block
    - Implement `classifyTransportError` to always return `{ mode: "network_error" }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [x] 2.2 Write property tests for the classifier (`failures.test.ts`)
    - **Property 1: Classifier totality and mutual exclusivity** — _Validates: Requirements 1.10_
    - **Property 2: Classifier status-to-mode mapping** — _Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
    - **Property 3: Transport errors classify as network_error** — _Validates: Requirements 1.9_
    - Use arbitrary `{ status, headers, body }` and arbitrary thrown values; tag each with `// Feature: llm-rate-limit-resilience, Property N: ...`; run `numRuns: 100`

  - [x] 2.3 Implement `parseRateLimitInfo`
    - Read `anthropic-ratelimit-unified-reset` (non-negative integer → `resetTimeMs = value * 1000`), else fall through to `retry-after` (non-negative integer, clamped to `[0, 86400]` seconds → `receivedAtMs + bounded * 1000`), else `resetTimeMs = null`
    - Clamp `resetTimeMs` up to `receivedAtMs` when it would be earlier; capture `retryAfterMs` from `retry-after` only; include `anthropic-ratelimit-unified-status` truncated to 256 chars
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.4 Write property tests for the rate-limit parser (`failures.test.ts`)
    - **Property 4: Reset_Time monotonicity and clamping** — _Validates: Requirements 2.6_
    - **Property 5: Reset_Time derivation and fallthrough** — _Validates: Requirements 2.1, 2.2, 2.3, 2.5_
    - **Property 6: Rate-limit status field is bounded** — _Validates: Requirements 2.4_
    - Use arbitrary reset/retry-after/status header combinations and received times; tag each property; run `numRuns: 100`

  - [x] 2.5 Implement `logFailure`
    - Emit exactly one structured `log` (pino) entry containing the failure mode, requested model, guild id, and provider type; include HTTP status when present and Reset_Time when `rate_limited` with a known reset
    - Only ever receive `{ guildId, providerType, model }` plus the secret-free `LlmFailure`, so no token is in scope at the call site
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 2.6 Write property tests for the failure logger (`failures.test.ts`)
    - **Property 15: Failure log shape** — _Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6_
    - **Property 16: Secret redaction invariant (log half)** — _Validates: Requirements 10.5_
    - Use an injected log sink and a `tokenArb` producing `sk-...` / `Bearer ...` secrets; assert redaction against the serialized entry; tag each property; run `numRuns: 100`

- [x] 3. Implement the `probeModel` I/O shell (`failures.ts`)
  - [x] 3.1 Implement `probeModel`
    - Perform one `max_tokens: 1` Messages-API call via an injectable `fetchFn`, reuse `buildAnthropicHeaders`, run under an `AbortController` bounded by `timeoutMs`, and delegate the outcome to `classifyResponse` / `classifyTransportError`; never throw — always resolve to `LlmCallResult`
    - _Requirements: 1.9, 5.7, 11.2_

  - [x] 3.2 Write unit tests for `probeModel` (`failures.test.ts`)
    - Inject `fetchFn` for 200 success, 429, 401, 529, malformed 200, and a thrown transport error; assert correct `LlmCallResult` and that `timeoutMs` aborts surface as `network_error`
    - _Requirements: 1.9, 11.2_

- [x] 4. Implement the pure message-builder (`apps/bot/src/llm/messages.ts`)
  - [x] 4.1 Implement `sanitizeUserMessage` and `formatResetTime`
    - `sanitizeUserMessage` neutralizes `@everyone`/`@here`/`<@..>`/`<@&..>` tokens and truncates to 2000 chars while preserving an optional `preserveTail` fragment by trimming from the middle
    - `formatResetTime` returns `{ absolute: <t:EPOCH:F>, relative: <t:EPOCH:R> }` for the correct epoch seconds
    - _Requirements: 3.4, 3.5, 3.6, 4.6, 4.7, 5.8_

  - [x] 4.2 Implement `buildChatFailureMessage`, `buildTaskFailureMessage`, and `lighterModelNotice`
    - Produce exactly one non-empty mode-specific string per failure mode for chat and task paths, applying provider-aware text (`claude_oauth` subscription note, `anthropic_api_key` no subscription text, `custom` uses `customModelName` / generic wording with no Anthropic tier name, `unknown` omits provider specifics); apply `sanitizeUserMessage` to every returned message
    - `lighterModelNotice` returns the mention-safe "reply produced by a lighter model due to rate limits" prefix
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 4.3 Write property tests for the message-builder (`messages.test.ts`)
    - **Property 7: Mention-safety invariant for all user messages** — _Validates: Requirements 3.4, 4.6, 5.8_
    - **Property 8: Truncation bound with statement preservation** — _Validates: Requirements 3.6_
    - **Property 9: Chat-path rate-limit message content** — _Validates: Requirements 3.1, 3.2, 3.3_
    - **Property 10: Chat-path failure message content per mode** — _Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5_
    - **Property 11: Task-path failure message content per mode** — _Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
    - **Property 12: Provider-type-aware messaging** — _Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5_
    - Use a `failureArb` and an `adversarialTextArb` injecting `@everyone`/`@here`/`<@123>`/`<@&123>` into provider/status/custom-model fields; tag each property; run `numRuns: 100`

- [x] 5. Implement the retry/backoff wrapper (`apps/bot/src/llm/retry.ts`)
  - [x] 5.1 Implement `callWithRetry` and `RetryPolicy`
    - Call `attempt` once; retry at most once only on `rate_limited`, honoring `retryAfterMs` via the injectable `sleep`, skipping when the wait exceeds `maxRetryDelayMs`, retrying immediately when no `retry-after`; never retry `auth_failed`/`model_error`/`overloaded`/`network_error`; return the final `LlmCallResult`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 5.2 Write property tests for the retry wrapper (`retry.test.ts`)
    - **Property 13: Retry is bounded to at most one additional attempt** — _Validates: Requirements 9.1_
    - **Property 14: Retry policy honors backoff and skip thresholds** — _Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6_
    - Use arbitrary first/second result sequences with an injected `sleep` recorder and a counting attempt fn; tag each property; run `numRuns: 100`

- [x] 6. Add configuration fields (`apps/bot/src/config.ts`, `.env.example`)
  - [x] 6.1 Add new zod config fields and document them
    - Add `CHAT_FALLBACK_ENABLED` (default disabled), `CHAT_FALLBACK_MODEL` (default `claude-haiku-4-5`), `RETRY_MAX_DELAY_SECONDS` (int `[0,30]`, default 5), and `CLASSIFIER_TIMEOUT_SECONDS` (int min 1, default 60); add a documented block under the `@mention chat` section in `.env.example`
    - _Requirements: 6.1, 6.2, 9.4, 1.9_

  - [x] 6.2 Write unit tests for config defaults (`config.test.ts`)
    - Assert `loadConfig` defaults: `CHAT_FALLBACK_ENABLED === false`, `CHAT_FALLBACK_MODEL` present, `RETRY_MAX_DELAY_SECONDS === 5` within `[0,30]`, `CLASSIFIER_TIMEOUT_SECONDS === 60`
    - _Requirements: 6.1, 6.2, 9.4_

- [x] 7. Refactor `chat.ts` to return structured results
  - [x] 7.1 Change `classifyIntent` / `generateChatReply` to structured results
    - Add `ClassifyResult` / `ReplyResult`; build requests as today, await the injectable `fetchFn`, guard JSON parse errors (200 + unparseable → `model_error`), and delegate to `classifyResponse` with the path-specific `validate` predicate; preserve `tool_use` `decide` parsing
    - Remove the `FALLBACK` constant and all generic "couldn't generate a response" strings so callers own user-facing copy
    - _Requirements: 1.6, 1.7, 8.2, 8.3, 8.4, 8.5_

  - [x] 7.2 Update chat unit tests for structured results (`chat.test.ts`)
    - Keep fetch-injection structure; assert happy-path `{ ok:true, decision }`, 429→`rate_limited`, 401→`auth_failed`, 529→`overloaded`, malformed 200→`model_error`, thrown→`network_error`; cover the live case (Haiku 200 + Sonnet 429)
    - _Requirements: 1.1, 1.2, 1.3, 1.7, 1.9, 8.2_

- [x] 8. Rewrite `handleMention` orchestration with fallback (`mentions.ts`)
  - [x] 8.1 Branch on classify/reply results and wire fallback
    - Wrap `classifyIntent` and `generateChatReply` in `callWithRetry`; on classify failure post exactly one `buildChatFailureMessage` and stop (no reply gen, no generic string); on `action === "reply"` failure post the mode message; when `rate_limited` and fallback enabled with a distinct `CHAT_FALLBACK_MODEL`, retry once on the fallback model and prefix `lighterModelNotice()` on success, else fall through to the rate-limit message; route `ask`/`code`/`propose` to `actOnDecision`; reuse the mention-safe `reply()` helper with `allowedMentions: { parse: [], repliedUser: true }`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 6.3, 6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 8.2 Write orchestration unit tests (`mentions.test.ts`)
    - Inject `fetchFn` sequences: classify 200 + reply 429 (fallback off) → one rate-limit message, never generic (8.1, 8.2); classify 429 → no reply call (8.3); classify 401/529 → mode message, no reply call (8.4); reply auth/overload/etc → mode message (8.5); fallback enabled + requested 429 + fallback 200 → one fallback call + lighter-model notice (6.3, 6.4); fallback disabled / non-distinct / both 429 → rate-limit message with correct call counts (6.5, 6.6, 6.7); assert `reply()` uses `allowedMentions: { parse: [], repliedUser: true }` (3.5, 4.7)
    - _Requirements: 3.5, 4.7, 6.3, 6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 9. Add the Task_Path preflight probe (`launch.ts`)
  - [x] 9.1 Probe the required Model_Tier before launch
    - In `checkSystemTaskPreconditions`, after existing gates and `assertLlmUsable` and before repo/cap resolution and `launchTask`, probe the required model (`CODE_MODEL` for `/code`, `DEFAULT_MODEL` for `/ask`) via `callWithRetry(probeModel(..., timeoutMs: CLASSIFIER_TIMEOUT_SECONDS * 1000))`; on any non-success return `{ ok:false, reason: buildTaskFailureMessage(...) }` so no thread, task row, or container is created
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.6_

  - [x] 9.2 Write preflight unit tests (`launch.test.ts`)
    - Mock orchestrator + db; for each failure mode assert preflight blocks `launchTask` and `db.insert` (zero task rows/containers) and returns the task failure reason
    - _Requirements: 5.7, 8.6_

- [x] 10. Add the admin `/llm-status` command and register it
  - [x] 10.1 Implement `llm-status.ts` handler and probe cache
    - Admin-gate on `ManageGuild` (deny with "Admin permission required" and no probing when absent); serve a < 60s per-guild cache without re-probing; otherwise probe `CHAT_MODEL`/`DEFAULT_MODEL`/`CODE_MODEL` via `probeModel` with `timeoutMs = 10_000` each wrapped once by `callWithRetry`; render an ephemeral report with provider type, per-tier success/Failure_Mode, `formatResetTime` for rate-limited tiers, reusing `sanitizeUserMessage` and never including the token or auth header
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 10.2 Register and dispatch `/llm-status`
    - Add the `/llm-status` builder in `commands.ts` with `DEFAULT_MEMBER_PERMISSIONS = ManageGuild`; add `case "llm-status"` dispatch in `interactions.ts` calling `handleLlmStatusCommand`
    - _Requirements: 11.1, 11.4_

  - [x] 10.3 Write `/llm-status` unit tests (`llm-status.test.ts`)
    - Fake `probeModel`; assert provider type rendered (11.1); each tier probed with `timeoutMs === 10000` and per-tier status rendered (11.2); rate-limited tier renders reset time (11.3); non-admin denied with zero probes (11.4); second call within 60s issues zero probes via clock control (11.5)
    - **Property 16: Secret redaction invariant (report half)** — _Validates: Requirements 11.6_
    - Tag the property test and run `numRuns: 100`

- [x] 11. Final checkpoint — verify the full feature
  - Run `pnpm --filter @anywarecode/bot typecheck` and `pnpm --filter @anywarecode/bot test`; ensure all tests (including the ≥100-iteration property tests) pass, with the mention-safety and redaction invariants (Properties 7, 16) treated as release-blocking. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation sub-tasks are never optional.
- Each task references specific requirement clauses for traceability, and every property-based test sub-task names the exact design property it implements.
- Pure leaf modules (`failures.ts`, `messages.ts`, `retry.ts`) and their property tests land before the consumers that import them, so errors are caught early.
- Property tests validate the universal invariants; example/unit tests cover orchestration, edge cases, and Discord-config concerns.
- All context documents (requirements.md, design.md) are assumed available during implementation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.2", "5.2", "6.2"] },
    { "id": 3, "tasks": ["2.4", "2.5", "4.3", "7.1"] },
    { "id": 4, "tasks": ["2.6", "3.1", "7.2"] },
    { "id": 5, "tasks": ["3.2", "8.1", "9.1"] },
    { "id": 6, "tasks": ["8.2", "9.2", "10.1"] },
    { "id": 7, "tasks": ["10.2"] },
    { "id": 8, "tasks": ["10.3"] }
  ]
}
```
