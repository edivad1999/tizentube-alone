FROM node:20-alpine

WORKDIR /app

COPY server/package.json ./
RUN npm install

COPY server/index.js ./

ENV TV_IP=""
ENV TIZENTUBE_VERSION=""

CMD ["sh", "-c", "npm install @foxreis/tizentube@${TIZENTUBE_VERSION:-latest} && node index.js ${TV_IP}"]
