FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy all application files
COPY . .

# Expose the proxy server port (set via PORT env, defaults to 3000)
EXPOSE 3030

# Health check to ensure the server is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3030/MOVIE || exit 1

# The PORT env var is read inside server.mjs (process.env.PORT || 3000)
ENV PORT=3030

# Start the proxy + json-server
CMD ["node", "server.mjs"]
