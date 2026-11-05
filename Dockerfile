# --- Compilation du site et du serveur ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# --- Image finale : uniquement ce qui sert à faire tourner le serveur ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

ENV PORT=3000 \
    PHOTOS_ROOT=/photos \
    WEB_DIST=/app/web/dist
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
