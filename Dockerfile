# Builds the app only. The database is a separate container — see
# scripts/fly-db-setup.sh and the "Deploying to Fly.io" section of the README.
# There is nothing Fly-specific here; `docker build` and `docker run` work the
# same anywhere, per the "Docker" section of the README.

FROM node:22-slim AS deps
WORKDIR /app
# openssl is required by the Prisma query engine at generate time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next/font and prisma both reach the network during this step — see
# "Building offline" in the README if that's not available here.
RUN npx prisma generate
RUN npm run build

# next.config.ts sets output: "standalone", so .next/standalone is a
# self-contained server with only the node_modules it actually traced —
# dramatically smaller than the full tree, which matters on a free-tier VM.
FROM node:22-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma

# Photos land here. In production this should be a mounted volume — Fly's
# fly.toml already points UPLOAD_DIR here via [mounts].
RUN mkdir -p /app/storage/uploads
VOLUME ["/app/storage"]

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
