FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl tini curl
ENV NODE_ENV=production
COPY package.json ./
# Copy full node_modules from builder — keeps prisma CLI available for migrations
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["api"]
