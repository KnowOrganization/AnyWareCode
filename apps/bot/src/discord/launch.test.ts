import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Guild } from "@anywarecode/db";
import type { Config } from "../config.js";
import type { FailureMode, LlmCallResult } from "../llm/failures.js";
import { hasInstallation } from "../github/installations.js";
import { resolveLlmAuth } from "../llm/credentials.js";
import { probeModel } from "../llm/failures.js";
import { checkSystemTaskPreconditions } from "./launch.js";

// The preflight reaches `probeModel` only after the installation + LLM-auth
// gates pass, so stub those module boundaries. `buildTaskFailureMessage`,
// `callWithRetry`, and `assertLlmUsable` stay real — we want the genuine
// failure copy and the real gate ordering under test.
vi.mock("../llm/failures.js", async (importActual) => ({
	...(await importActual<typeof import("../llm/failures.js")>()),
	probeModel: vi.fn(),
}));
vi.mock("../llm/credentials.js", async (importActual) => ({
	...(await importActual<typeof import("../llm/credentials.js")>()),
	resolveLlmAuth: vi.fn(),
}));
vi.mock("../github/installations.js", async (importActual) => ({
	...(await importActual<typeof import("../github/installations.js")>()),
	hasInstallation: vi.fn(),
}));

const probeModelMock = vi.mocked(probeModel);
const resolveLlmAuthMock = vi.mocked(resolveLlmAuth);
const hasInstallationMock = vi.mocked(hasInstallation);

const config = {
	CODE_MODEL: "claude-code-model",
	DEFAULT_MODEL: "claude-default-model",
	CLASSIFIER_TIMEOUT_SECONDS: 30,
	RETRY_MAX_DELAY_SECONDS: 60,
	MAX_PROMPT_CHARS: 4000,
	STATE_SECRET: "secret",
	INSTALL_STATE_TTL_MINUTES: 10,
} as unknown as Config;

/** A guild that clears every earlier gate: not suspended, Free tier (so the
 *  OSS private-repo recheck is skipped) and well under its task cap. */
function makeGuild(): Guild {
	return {
		id: "g1",
		suspended: false,
		planId: "free",
		subStatus: "free",
		ossStatus: null,
		taskCap: 15,
		tasksUsedThisMonth: 0,
		asksUsedThisMonth: 0,
		packTasksRemaining: 0,
		allowedRoleId: null,
		requireLinkedSponsor: false,
		capResetAt: new Date(Date.now() + 30 * 86_400_000),
	} as unknown as Guild;
}

function makeCtx() {
	const insert = vi.fn();
	const run = vi.fn();
	const db = {
		query: {
			channelRepos: {
				findFirst: vi.fn(async () => ({
					channelId: "c1",
					repoFullName: "o/r",
					installationId: 123,
				})),
			},
		},
		insert,
	};
	const ctx = {
		db,
		config,
		github: {
			installUrl: vi.fn(() => "https://install"),
			repoIsPrivate: vi.fn(async () => false),
		},
		orchestrator: { run },
		client: {},
	} as unknown as Parameters<typeof checkSystemTaskPreconditions>[0];
	return { ctx, insert, run };
}

function failure(mode: FailureMode): LlmCallResult {
	return {
		ok: false,
		failure: {
			mode,
			...(mode === "rate_limited"
				? {
						rateLimitInfo: {
							resetTimeMs: Date.now() + 60_000,
							retryAfterMs: null,
						},
					}
				: {}),
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// Default: gates before the probe pass.
	hasInstallationMock.mockResolvedValue(true);
	resolveLlmAuthMock.mockResolvedValue({
		auth: { type: "anthropic_api_key", token: "sk-x" },
		source: "guild",
	});
});

describe("checkSystemTaskPreconditions preflight probe", () => {
	const modes: FailureMode[] = [
		"rate_limited",
		"auth_failed",
		"overloaded",
		"model_error",
		"network_error",
	];

	for (const mode of modes) {
		it(`blocks the launch on a ${mode} probe — no task row, no container`, async () => {
			const { ctx, insert, run } = makeCtx();
			probeModelMock.mockResolvedValue(failure(mode));

			const result = await checkSystemTaskPreconditions(
				ctx,
				makeGuild(),
				"code",
				{ channelId: "c1" },
				"do the thing",
			);

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected a blocked precondition");
			// The reason is the real buildTaskFailureMessage output.
			expect(typeof result.reason).toBe("string");
			expect(result.reason.length).toBeGreaterThan(0);

			// No container started and no task/thread rows written.
			expect(run).not.toHaveBeenCalled();
			expect(insert).not.toHaveBeenCalled();
		});
	}

	it("rate-limit copy names the rate limit and recovery", async () => {
		const { ctx } = makeCtx();
		probeModelMock.mockResolvedValue(failure("rate_limited"));

		const result = await checkSystemTaskPreconditions(
			ctx,
			makeGuild(),
			"code",
			{ channelId: "c1" },
			"do the thing",
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a blocked precondition");
		expect(result.reason).toContain("rate limit");
	});

	it("a successful probe proceeds past the preflight to ok", async () => {
		const { ctx, insert, run } = makeCtx();
		probeModelMock.mockResolvedValue({ ok: true, body: {} });

		const result = await checkSystemTaskPreconditions(
			ctx,
			makeGuild(),
			"code",
			// Direct repo ref → skips the channel-binding lookup; Free tier skips
			// the private-repo recheck; cap is well under the limit.
			{ repoFullName: "o/r", installationId: 123 },
			"do the thing",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(`unexpected block: ${result.reason}`);
		expect(result.repoFullName).toBe("o/r");
		expect(result.installationId).toBe(123);
		// Preconditions never start the run or write rows; that's launchTask's job.
		expect(run).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
	});

	it("probes CODE_MODEL for mode 'code'", async () => {
		const { ctx } = makeCtx();
		probeModelMock.mockResolvedValue({ ok: true, body: {} });

		await checkSystemTaskPreconditions(
			ctx,
			makeGuild(),
			"code",
			{ repoFullName: "o/r", installationId: 123 },
			"do the thing",
		);

		expect(probeModelMock).toHaveBeenCalledTimes(1);
		expect(probeModelMock.mock.calls[0]?.[0]?.model).toBe(config.CODE_MODEL);
	});

	it("probes DEFAULT_MODEL for mode 'ask'", async () => {
		const { ctx } = makeCtx();
		probeModelMock.mockResolvedValue({ ok: true, body: {} });

		await checkSystemTaskPreconditions(
			ctx,
			makeGuild(),
			"ask",
			{ repoFullName: "o/r", installationId: 123 },
			"answer the question",
		);

		expect(probeModelMock).toHaveBeenCalledTimes(1);
		expect(probeModelMock.mock.calls[0]?.[0]?.model).toBe(
			config.DEFAULT_MODEL,
		);
	});
});
