FROM node:22-alpine AS builder

WORKDIR /app

# Install Python3 (required by youtube-dl-exec)
RUN apk add --no-cache python3 && ln -sf python3 /usr/bin/python

# Install dependencies
COPY package*.json ./
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true
RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install Python3 and yt-dlp (required by youtube-dl-exec)
RUN apk add --no-cache python3 yt-dlp && ln -sf python3 /usr/bin/python

# Copy package info and install only production dependencies
COPY package*.json ./
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev && \
    mkdir -p node_modules/youtube-dl-exec/bin && \
    ln -sf /usr/bin/yt-dlp node_modules/youtube-dl-exec/bin/yt-dlp

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
