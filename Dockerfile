# Multi-stage build for GitHub Event Router
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY server ./server
COPY config ./config

# Build TypeScript
RUN npm run build:server

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config
COPY migrations ./migrations

# Create database directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8080

# Set environment
ENV NODE_ENV=production

# Start the application
CMD ["node", "--enable-source-maps", "dist/server/index.js"]
