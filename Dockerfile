FROM docker.io/cloudflare/sandbox:0.7.0

# Install Node.js 22 (required by clawdbot) and rsync (for R2 backup sync)
# The base image has Node 20, we need to replace it with Node 22
# Using direct binary download for reliability
ENV NODE_VERSION=22.13.1
RUN apt-get update && apt-get install -y xz-utils ca-certificates rsync git \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

# Install pnpm globally
RUN npm install -g pnpm

# Install moltbot (CLI is still named clawdbot until upstream renames)
# Pin to specific version for reproducible builds
RUN npm install -g clawdbot@2026.1.24-3 \
    && clawdbot --version

# Install himalaya (IMAP email CLI) - pinned version for reproducible builds
ENV HIMALAYA_VERSION=1.1.0
RUN curl -fsSL https://github.com/pimalaya/himalaya/releases/download/v${HIMALAYA_VERSION}/himalaya.x86_64-linux.tgz -o /tmp/himalaya.tgz \
    && tar -xzf /tmp/himalaya.tgz -C /usr/local/bin himalaya \
    && rm /tmp/himalaya.tgz \
    && chmod +x /usr/local/bin/himalaya \
    && himalaya --version

# Install gog (Google Workspace CLI) - pinned version for reproducible builds
ENV GOG_VERSION=0.9.0
RUN curl -fsSL https://github.com/steipete/gogcli/releases/download/v${GOG_VERSION}/gogcli_${GOG_VERSION}_linux_amd64.tar.gz -o /tmp/gog.tar.gz \
    && tar -xzf /tmp/gog.tar.gz -C /usr/local/bin gog \
    && rm /tmp/gog.tar.gz \
    && chmod +x /usr/local/bin/gog \
    && gog --version

# Create moltbot directories (paths still use clawdbot until upstream renames)
# Templates are stored in /root/.clawdbot-templates for initialization
RUN mkdir -p /root/.clawdbot \
    && mkdir -p /root/.clawdbot-templates \
    && mkdir -p /root/clawd \
    && mkdir -p /root/clawd/skills

# Copy startup script
ARG CACHE_BUST=2026-01-31-git-init-order
COPY start-moltbot.sh /usr/local/bin/start-moltbot.sh
RUN chmod +x /usr/local/bin/start-moltbot.sh && echo "build: $CACHE_BUST" > /usr/local/bin/.build-info

# Copy default configuration template
COPY moltbot.json.template /root/.clawdbot-templates/moltbot.json.template

# Copy custom skills
COPY skills/ /root/clawd/skills/

# Set working directory
WORKDIR /root/clawd

# Expose the gateway port
EXPOSE 18789
