FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile --filter './services/**' --filter @schoolconnect/contracts --filter @schoolconnect/eventing
RUN pnpm --filter './services/**' --filter @schoolconnect/contracts --filter @schoolconnect/eventing run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SERVICE_BIND_HOST=::
ENV SERVICE_NAME=api
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "scripts/start-service.mjs"]
