import { describe, expect, it, vi } from "vitest";
import type { GitHubService } from "./app.js";
import { hasInstallation, resolveInstallationForRepo } from "./installations.js";

function mockDb(opts: {
  installations: Array<{ installationId: number; accountLogin: string }>;
  binding?: { installationId: number } | null;
}) {
  return {
    query: {
      guildInstallations: {
        findMany: vi.fn(async () =>
          opts.installations.map((i, idx) => ({
            guildId: "g1",
            ...i,
            linkedAt: new Date(2026, 0, idx + 1),
          })),
        ),
      },
      channelRepos: {
        findFirst: vi.fn(async () => opts.binding ?? undefined),
      },
    },
  } as unknown as Parameters<typeof resolveInstallationForRepo>[0];
}

function mockGithub(reposByInstall: Record<number, string[]>): GitHubService {
  return {
    listRepos: vi.fn(async (id: number) => reposByInstall[id] ?? []),
  } as unknown as GitHubService;
}

describe("hasInstallation", () => {
  it("reflects linked-installation count", async () => {
    expect(await hasInstallation(mockDb({ installations: [] }), "g1")).toBe(false);
    expect(
      await hasInstallation(
        mockDb({ installations: [{ installationId: 1, accountLogin: "mo" }] }),
        "g1",
      ),
    ).toBe(true);
  });
});

describe("resolveInstallationForRepo", () => {
  it("returns null with no installations, the only one when single", async () => {
    expect(
      await resolveInstallationForRepo(
        mockDb({ installations: [] }),
        mockGithub({}),
        "g1",
        "o/r",
      ),
    ).toBeNull();
    expect(
      await resolveInstallationForRepo(
        mockDb({ installations: [{ installationId: 7, accountLogin: "mo" }] }),
        mockGithub({}),
        "g1",
        "o/r",
      ),
    ).toBe(7);
  });

  it("prefers an existing channel binding over probing", async () => {
    const github = mockGithub({});
    const db = mockDb({
      installations: [
        { installationId: 1, accountLogin: "mo" },
        { installationId: 2, accountLogin: "acme-org" },
      ],
      binding: { installationId: 2 },
    });
    expect(await resolveInstallationForRepo(db, github, "g1", "acme/app")).toBe(2);
    expect(github.listRepos).not.toHaveBeenCalled();
  });

  it("probes installations in linked order and caches the answer", async () => {
    const github = mockGithub({ 1: ["mo/dots"], 2: ["acme/app"] });
    const db = mockDb({
      installations: [
        { installationId: 1, accountLogin: "mo" },
        { installationId: 2, accountLogin: "acme-org" },
      ],
      binding: null,
    });
    expect(
      await resolveInstallationForRepo(db, github, "g1", "acme/app"),
    ).toBe(2);
    // Second call within the TTL: served from cache, no extra probing.
    expect(
      await resolveInstallationForRepo(db, github, "g1", "acme/app"),
    ).toBe(2);
    expect(github.listRepos).toHaveBeenCalledTimes(2); // 1 then 2, once each
  });

  it("returns null when no installation can see the repo", async () => {
    const github = mockGithub({ 1: [], 2: [] });
    const db = mockDb({
      installations: [
        { installationId: 1, accountLogin: "mo" },
        { installationId: 2, accountLogin: "acme-org" },
      ],
      binding: null,
    });
    expect(
      await resolveInstallationForRepo(db, github, "g1", "ghost/repo"),
    ).toBeNull();
  });
});
