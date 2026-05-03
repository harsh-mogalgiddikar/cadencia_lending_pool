# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy deps first for layer caching
COPY package.json ./
RUN npm install

# Copy source
COPY . .

# Build production bundle
ARG VITE_API_URL=/api
ARG VITE_NETWORK=testnet
ARG VITE_ALGOD_SERVER=https://testnet-api.algonode.cloud
ARG VITE_KYC_REGISTRY_APP_ID=759379619
ARG VITE_CREDIT_SCORE_APP_ID=759379629
ARG VITE_LENDING_POOL_APP_ID=759379630
ARG VITE_LOAN_MANAGER_APP_ID=759379631
ARG VITE_REPAYMENT_ESCROW_APP_ID=759379632
ARG VITE_WC_PROJECT_ID=f111ad3365ccd5e46207536bc4914183

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_NETWORK=$VITE_NETWORK
ENV VITE_ALGOD_SERVER=$VITE_ALGOD_SERVER
ENV VITE_KYC_REGISTRY_APP_ID=$VITE_KYC_REGISTRY_APP_ID
ENV VITE_CREDIT_SCORE_APP_ID=$VITE_CREDIT_SCORE_APP_ID
ENV VITE_LENDING_POOL_APP_ID=$VITE_LENDING_POOL_APP_ID
ENV VITE_LOAN_MANAGER_APP_ID=$VITE_LOAN_MANAGER_APP_ID
ENV VITE_REPAYMENT_ESCROW_APP_ID=$VITE_REPAYMENT_ESCROW_APP_ID
ENV VITE_WC_PROJECT_ID=$VITE_WC_PROJECT_ID

RUN npm run build

# ── Stage 2: Serve ──────────────────────────────────────────
FROM nginx:alpine AS production

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Custom nginx config — handles SPA routing + reverse proxy to API
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
