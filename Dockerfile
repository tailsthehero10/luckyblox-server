FROM node:18-alpine

ENV NODE_ENV=production

WORKDIR /app

# Copy the dependency configurations first
COPY Webserver/http-db-bridge/package*.json ./Webserver/http-db-bridge/

# Install the dependencies cleanly inside the container
RUN cd Webserver/http-db-bridge && npm ci --omit=dev

# Copy the actual script code so the files exist inside the container
COPY server.js ./
COPY Webserver/ ./Webserver/

EXPOSE 3001 3002

CMD ["sh", "-c", "node Webserver/http-db-bridge/server.js & node server.js"]
