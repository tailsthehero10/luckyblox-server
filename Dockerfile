FROM node:18-alpine

WORKDIR /app

COPY Webserver/http-db-bridge/package.json Webserver/http-db-bridge/

WORKDIR /app/Webserver/http-db-bridge
RUN npm install --production

WORKDIR /app
COPY . .

EXPOSE 3001 3002

CMD ["sh", "-c", "node Webserver/http-db-bridge/server.js & node server.js"]
