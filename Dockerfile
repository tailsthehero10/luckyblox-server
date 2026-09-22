FROM node:18-alpine

# Set high-performance production environment variables
ENV NODE_ENV=production

WORKDIR /app

# 1. Copy package files first to leverage Docker layer caching
COPY Webserver/http-db-bridge/package*.json ./Webserver/http-db-bridge/
COPY package*.json ./

# 2. Install dependencies cleanly and fast
RUN cd Webserver/http-db-bridge && npm ci --only=production
RUN npm ci --only=production --ignore-scripts

# 3. Copy the rest of the application files
COPY . .

EXPOSE 3001 3002

# 4. Use an explicit, optimized execution string
CMD ["sh", "-c", "node Webserver/http-db-bridge/server.js & node server.js"]
