FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

# Default: start the API server
# Override start command in Railway per-service for oracle/jobs workers
CMD ["node", "api/src/server.js"]
