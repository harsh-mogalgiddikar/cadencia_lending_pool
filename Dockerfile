FROM node:22-alpine

WORKDIR /app

COPY backend/backend/package.json backend/backend/package-lock.json ./
RUN npm install --omit=dev

COPY backend/backend/ .

EXPOSE 3001

CMD ["node", "api/src/server.js"]
