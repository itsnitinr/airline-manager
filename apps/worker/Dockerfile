# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@airline-manager/worker... \
  && pnpm --filter @airline-manager/worker deploy --prod /output

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV WORKER_HEALTH_HOST=0.0.0.0
ENV WORKER_HEALTH_PORT=3002
WORKDIR /app
COPY --from=build --chown=node:node /output/package.json ./package.json
COPY --from=build --chown=node:node /output/node_modules ./node_modules
COPY --from=build --chown=node:node /output/dist ./dist
USER node
EXPOSE 3002
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3002/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
