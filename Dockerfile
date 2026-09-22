# LuckyBlox server — Linux/Docker image for Render.com
#
# Runs the Node compatibility proxy + the Express http-db-bridge on the single
# port the platform gives us (process.env.PORT) and serves the Webserver/ folder
# (static assets + raw PHP endpoints) through the bundled PHP runtime.

FROM node:18-bookworm-slim

ENV NODE_ENV=production \
    DEBIAN_FRONTEND=noninteractive

# PHP CLI is required for the raw server-side logic under Webserver/www/*.php
# (join scripts, placelauncher, health, etc.).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        php-cli \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first so Docker can cache this layer.
COPY Webserver/http-db-bridge/package*.json ./Webserver/http-db-bridge/
RUN cd Webserver/http-db-bridge && (npm ci --omit=dev || npm install --omit=dev)

# Copy the application source.
COPY . .

# Render/Heroku-style platforms inject PORT at runtime; default it for local use.
ENV PORT=3002 \
    HOST=0.0.0.0 \
    LUCKYBLOX_BRIDGE_HOST=127.0.0.1 \
    LUCKYBLOX_BRIDGE_PORT=3001 \
    LUCKYBLOX_GAME_HOST=0.0.0.0

# The platform routes to a single port, so we do not EXPOSE fixed 3001/3002.
EXPOSE 3002

# start.js is the process manager: it boots both Node processes, keeps them
# alive, and forwards shutdown signals — no fragile "cmd & cmd" chaining.
CMD ["node", "start.js"]
