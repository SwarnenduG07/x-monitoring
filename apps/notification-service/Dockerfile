FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json turbo.json ./
COPY apps/notification-service/package.json ./apps/notification-service/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/

# Install dependencies
RUN npm install

# Copy source code
COPY tsconfig.base.json ./
COPY apps/notification-service ./apps/notification-service
COPY packages/shared ./packages/shared
COPY packages/database ./packages/database

# Build the apps
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/apps/notification-service/package.json /app/apps/notification-service/package.json
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=builder /app/packages/database/package.json /app/packages/database/package.json
COPY --from=builder /app/apps/notification-service/dist /app/apps/notification-service/dist
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/packages/database/dist /app/packages/database/dist
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/database/node_modules/.prisma /app/packages/database/node_modules/.prisma

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3003

# Expose port
EXPOSE 3003

# Start the service
CMD ["node", "apps/notification-service/dist/index.js"] 