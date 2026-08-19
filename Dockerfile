# Multi-stage / optimized Dockerfile for Interview AI WebSocket Server on Google Cloud Run
FROM node:22-slim AS builder

WORKDIR /app

# Copy root and functions package files
COPY package*.json ./
COPY functions/package*.json ./functions/

# Install all dependencies required for TypeScript compilation
RUN npm ci --prefix functions

# Copy TypeScript configuration and source code
COPY tsconfig.json ./
COPY functions/ ./functions/

# Build TypeScript to functions/lib
RUN npm --prefix functions run build

# Prune devDependencies for production runtime
RUN npm prune --production --prefix functions

# Production runner stage
FROM node:22-slim AS runner

WORKDIR /app

# Copy built outputs and production dependencies from builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/functions/package*.json ./functions/
COPY --from=builder /app/functions/node_modules ./functions/node_modules
COPY --from=builder /app/functions/lib ./functions/lib

# Default environment variables for Cloud Run
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# Run compiled standalone HTTP & WebSocket server
CMD ["node", "functions/lib/server.js"]
