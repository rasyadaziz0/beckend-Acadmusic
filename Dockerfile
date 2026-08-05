FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy package info and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create cache directory and set ownership for non-root user
RUN mkdir -p /app/.cache/innertube && chown -R node:node /app/.cache

# Expose API port
EXPOSE 4000

# Set Node environment
ENV NODE_ENV=production
ENV PORT=4000

# Run as non-root user
USER node

# Start server
CMD ["node", "dist/server.js"]
