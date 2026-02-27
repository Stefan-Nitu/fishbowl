FROM oven/bun:1 AS base

RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /sandbox

# Install sandbox dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy sandbox source
COPY . .

# Create data directories
RUN mkdir -p /data /workspace/lower /workspace/merged

ENTRYPOINT ["/sandbox/container/entrypoint.sh"]
