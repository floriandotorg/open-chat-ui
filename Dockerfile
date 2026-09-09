FROM oven/bun:1 AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN POCKETBASE_URL=http://localhost:8090 \
    PUBLIC_POCKETBASE_URL=http://localhost:8090 \
    POCKETBASE_ADMIN_EMAIL=build@local \
    POCKETBASE_ADMIN_PASSWORD=buildbuild \
    ORIGIN=http://localhost \
    ENCRYPTION_SECRET=build-secret-placeholder-32chars-minimum \
    bun run build

FROM oven/bun:1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv pipx && rm -rf /var/lib/apt/lists/*
RUN pipx install flights && pipx inject flights click
ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/pocketbase ./pocketbase
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
ENV NODE_ENV=production
ENV BODY_SIZE_LIMIT=10M
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
