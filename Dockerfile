FROM node:24.18.0-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY frontend/ ./frontend/
COPY vite.config.js ./

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
