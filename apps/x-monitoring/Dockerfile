FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json turbo.json ./
COPY apps/x-monitoring/package.json ./apps/x-monitoring/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN npm install

# Copy source code
COPY tsconfig.base.json ./
COPY apps/x-monitoring ./apps/x-monitoring
COPY packages/shared ./packages/shared

# Build the apps
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/apps/x-monitoring/package.json /app/apps/x-monitoring/package.json
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=builder /app/apps/x-monitoring/dist /app/apps/x-monitoring/dist
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist

# Install production dependencies only
RUN npm install --omit=dev

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start the service
CMD ["node", "apps/x-monitoring/dist/index.js"] 