# Build stage for client
FROM node:22-alpine AS client-build
WORKDIR /app

# Copy all package files for workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install all dependencies (workspace mode)
RUN npm install --global pnpm@11.24.0 && pnpm install --frozen-lockfile

# Copy source code
COPY client/ ./client/
COPY server/ ./server/

# Build client
RUN pnpm --filter client run build

# Production stage
FROM node:22-alpine AS production
WORKDIR /app

# System deps for movie clip cache
# yt-dlp[default]: includes EJS challenge solver scripts for YouTube
# Node.js (already in base image) is used as the JS runtime via --js-runtimes node
RUN apk add --no-cache ffmpeg python3 py3-pip && \
    pip install --break-system-packages "yt-dlp[default]"

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install production dependencies only
RUN npm install --global pnpm@11.24.0 && pnpm --filter server install --prod --frozen-lockfile

# Copy server code
COPY server/ ./server/

# Copy built client from build stage
COPY --from=client-build /app/client/dist ./client/dist

# Expose port
EXPOSE 7111

ENV NODE_ENV=production
ENV PORT=7111

# Start server
WORKDIR /app/server
CMD ["node", "index.js"]
