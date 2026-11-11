# syntax=docker/dockerfile:1
FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
# 1. Copy manifest first and install production deps (cached unless package.json changes!)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
# 2. Copy source code owned by the non-root "node" user (UID 1000)
COPY --chown=node:node . .
# 3. Drop root privileges
USER node
EXPOSE 3000
# 4. Built-in healthcheck using Alpine's wget
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# 5. Exec form so "node" is PID 1 and receives SIGTERM directly
CMD ["node", "server.js"]
