FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-slim AS runtime

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev --workspace @khalik/server --include-workspace-root=false \
  && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/client/THIRD_PARTY_NOTICES ./client/THIRD_PARTY_NOTICES

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

USER node
CMD ["node", "server/dist/server/src/index.js"]
