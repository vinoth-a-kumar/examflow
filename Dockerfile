FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PORT=5001 \
    DB_HOST=127.0.0.1 \
    DB_PORT=3306 \
    DB_USER=root \
    DB_PASSWORD="" \
    DB_NAME=examflow \
    NODE_ENV=production

# Install MariaDB Server & Client, Node.js 20 runtime, curl, ca-certificates, and procps
RUN apt-get update && apt-get install -y --no-install-recommends \
    mariadb-server \
    mariadb-client \
    curl \
    ca-certificates \
    procps \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund

# Invalidate cache for backend and entrypoint
RUN echo "build_v17_exam_location_font_size_plus_2" > /tmp/build_ver

# Copy backend application source
COPY backend/ ./backend/

# Copy pre-compiled frontend production assets
COPY build/ ./build/

# Copy and configure startup entrypoint
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose default application port (remap to 5001 or 5003 on host)
EXPOSE 5001

# Volumes for MySQL database and application file persistence
VOLUME ["/var/lib/mysql", "/app/backend/data"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
