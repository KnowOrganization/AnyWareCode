# Built from the repo root: docker build -f apps/bot/Dockerfile -t anywherecode-bot .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/bot/package.json apps/bot/
RUN pnpm install --frozen-lockfile --filter @anywherecode/bot...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/bot apps/bot
RUN pnpm --filter @anywherecode/shared build && pnpm --filter @anywherecode/bot build
RUN pnpm --filter @anywherecode/bot --prod deploy --legacy /out

FROM node:22-slim
# The bot spawns runner containers via Docker socket — no git/other packages needed.
COPY --from=build /out /bot
# Drizzle migrations are not part of the JS bundle; copy explicitly.
COPY apps/bot/drizzle /bot/drizzle
EXPOSE 3000
WORKDIR /bot
ENTRYPOINT ["node", "dist/index.js"]
