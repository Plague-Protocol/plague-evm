# Build context is this directory (x-bot/) — it has no workspace deps.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm test

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# Telegram long-polling and outbound HTTPS only: no inbound port to EXPOSE.
CMD ["node", "dist/index.js"]
