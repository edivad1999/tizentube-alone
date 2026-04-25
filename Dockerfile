FROM node:20-alpine

WORKDIR /app

COPY server/package.json ./
# Install server deps then pull latest TizenTube userscript from npm
RUN npm install && npm install @foxreis/tizentube@latest

COPY server/index.js ./

# TV_IP can be passed as env var or as first CLI argument
ENV TV_IP=""

CMD ["sh", "-c", "node index.js ${TV_IP}"]
