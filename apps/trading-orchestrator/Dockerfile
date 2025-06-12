FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json turbo.json ./
COPY apps/trading-orchestrator/package.json ./apps/trading-orchestrator/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/

# Install dependencies
RUN npm install

# Copy source code
COPY tsconfig.base.json ./
COPY apps/trading-orchestrator ./apps/trading-orchestrator
COPY packages/shared ./packages/shared
COPY packages/database ./packages/database

# Build the apps
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/apps/trading-orchestrator/package.json /app/apps/trading-orchestrator/package.json
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=builder /app/packages/database/package.json /app/packages/database/package.json
COPY --from=builder /app/apps/trading-orchestrator/dist /app/apps/trading-orchestrator/dist
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/packages/database/dist /app/packages/database/dist
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/database/node_modules/.prisma /app/packages/database/node_modules/.prisma

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3002

# Expose port
EXPOSE 3002

# Start the service
CMD ["node", "apps/trading-orchestrator/dist/index.js"] 