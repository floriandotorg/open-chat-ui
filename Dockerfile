FROM oven/bun:1 AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN DATABASE_URL=/tmp/build.db BETTER_AUTH_SECRET=build ENCRYPTION_SECRET=build ORIGIN=http://localhost bun run build

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/src/lib/server/db ./src/lib/server/db
COPY --from=builder /app/scripts ./scripts
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
ENV NODE_ENV=production
ENV BODY_SIZE_LIMIT=10M
EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["./entrypoint.sh"]
