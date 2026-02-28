FROM oven/bun:1 AS base

RUN apt-get update && apt-get install -y \
    git \
    curl \
    rsync \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /sandbox

# Install sandbox dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy sandbox source
COPY . .

# Create data directories
RUN mkdir -p /data /workspace/lower /workspace/merged \
    && useradd -m -s /bin/bash agent \
    && chown -R agent:agent /data /workspace /sandbox

USER agent

ENTRYPOINT ["/sandbox/container/entrypoint.sh"]
