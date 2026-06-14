# Built from the repo root: docker build -f apps/bot/Dockerfile -t anywarecode-bot .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/bot/package.json apps/bot/
RUN pnpm install --frozen-lockfile --filter @anywarecode/bot...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/bot apps/bot
RUN pnpm --filter @anywarecode/shared build \
  && pnpm --filter @anywarecode/db build \
  && pnpm --filter @anywarecode/bot build
RUN pnpm --filter @anywarecode/bot --prod deploy --legacy /out

FROM node:22-slim
# The bot spawns runner containers via Docker socket — no git/other packages needed.
COPY --from=build /out /bot
# Drizzle migrations live in @anywarecode/db and aren't part of the JS bundle;
# migrationsDir resolves to <pkg>/drizzle, so place them there explicitly.
COPY --from=build /app/packages/db/drizzle /bot/node_modules/@anywarecode/db/drizzle
EXPOSE 3000
WORKDIR /bot
ENTRYPOINT ["node", "dist/index.js"]
