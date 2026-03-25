FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production

FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY index.js .
USER app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "index.js"]
