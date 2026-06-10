# Built from the repo root: docker build -f apps/runner/Dockerfile -t anywherecode-runner .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/runner/package.json apps/runner/
RUN pnpm install --frozen-lockfile --filter @anywherecode/runner...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/runner apps/runner
RUN pnpm --filter @anywherecode/shared build && pnpm --filter @anywherecode/runner build
RUN pnpm --filter @anywherecode/runner --prod deploy /out

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Git credential helper: feeds the installation token to git via GIT_PAT so it
# never appears in the remote URL, .git/config, or process args.
COPY apps/runner/git-askpass.sh /usr/local/bin/git-askpass.sh
RUN chmod 0555 /usr/local/bin/git-askpass.sh
# Non-root user; /work holds the ephemeral clone.
RUN useradd -m runner && mkdir /work && chown runner /work
COPY --from=build /out /runner
USER runner
WORKDIR /work
ENTRYPOINT ["node", "/runner/dist/index.js"]
