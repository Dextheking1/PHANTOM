FROM node:24.18.0-bookworm-slim

WORKDIR /app

# REA uses ps for owned-process checks during local analysis.
RUN apt-get update && apt-get install -y --no-install-recommends procps ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY frontend/ ./frontend/
COPY vite.config.js ./
COPY .opencode/skills/rea-reverse-engineering/ ./.opencode/skills/rea-reverse-engineering/

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
