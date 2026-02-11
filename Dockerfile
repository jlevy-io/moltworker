FROM docker.io/cloudflare/sandbox:0.7.0

# Install Node.js 22 (required by OpenClaw) and rsync (for R2 backup sync)
# The base image has Node 20, we need to replace it with Node 22
# Using direct binary download for reliability
ENV NODE_VERSION=22.13.1
RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
         amd64) NODE_ARCH="x64" ;; \
         arm64) NODE_ARCH="arm64" ;; \
         *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
       esac \
    && apt-get update && apt-get install -y xz-utils ca-certificates rsync git \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

# Install pnpm globally
RUN npm install -g pnpm

# Install OpenClaw (formerly clawdbot/moltbot)
# Pin to specific version for reproducible builds
RUN npm install -g openclaw@2026.2.3 \
    && openclaw --version

# Install himalaya (IMAP email CLI) - pinned version for reproducible builds
ENV HIMALAYA_VERSION=1.1.0
RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
         amd64) HIMALAYA_ARCH="x86_64" ;; \
         arm64) HIMALAYA_ARCH="aarch64" ;; \
         *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
       esac \
    && curl -fsSL https://github.com/pimalaya/himalaya/releases/download/v${HIMALAYA_VERSION}/himalaya.${HIMALAYA_ARCH}-linux.tgz -o /tmp/himalaya.tgz \
    && tar -xzf /tmp/himalaya.tgz -C /usr/local/bin himalaya \
    && rm /tmp/himalaya.tgz \
    && chmod +x /usr/local/bin/himalaya \
    && himalaya --version

# Install gog (Google Workspace CLI) - pinned version for reproducible builds
ENV GOG_VERSION=0.9.0
RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
         amd64) GOG_ARCH="amd64" ;; \
         arm64) GOG_ARCH="arm64" ;; \
         *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
       esac \
    && curl -fsSL https://github.com/steipete/gogcli/releases/download/v${GOG_VERSION}/gogcli_${GOG_VERSION}_linux_${GOG_ARCH}.tar.gz -o /tmp/gog.tar.gz \
    && tar -xzf /tmp/gog.tar.gz -C /usr/local/bin gog \
    && rm /tmp/gog.tar.gz \
    && chmod +x /usr/local/bin/gog \
    && gog --version

# Create OpenClaw directories
# Legacy .clawdbot paths are kept for R2 backup migration
RUN mkdir -p /root/.openclaw \
    && mkdir -p /root/clawd \
    && mkdir -p /root/clawd/skills

# Copy startup script
# Build cache bust: 2026-02-06-v29-sync-workspace
COPY start-openclaw.sh /usr/local/bin/start-openclaw.sh
RUN chmod +x /usr/local/bin/start-openclaw.sh

# Copy custom skills and build any that have TypeScript source
COPY skills/ /root/clawd/skills/
RUN cd /root/clawd/skills/ms-graph && npm install && npm run build && rm -rf node_modules

# Set working directory
WORKDIR /root/clawd

# Expose the gateway port
EXPOSE 18789
