# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# The database runs in its official container. Skip FalkorDBLite's install hook.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
COPY next.config.mjs next-env.d.ts tsconfig.json ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --chown=node:node deploy/local/verify.mjs ./deploy/local/verify.mjs
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
