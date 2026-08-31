# Build the client, then run the self-contained Node + WebSocket server that
# serves it. One image, one port.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install all workspace deps (dev deps needed to build the client).
RUN npm install

COPY . .

# Build the React client to client/dist.
RUN npm run build

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
