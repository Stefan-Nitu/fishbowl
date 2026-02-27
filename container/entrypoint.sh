#!/bin/bash
set -e

echo "[sandbox] Setting up sandbox environment..."

# --- OverlayFS ---
# /workspace/lower = read-only host project (bind mounted)
# /workspace/upper = writable layer (agent writes captured here)
# /workspace/work  = overlayfs workdir
# /workspace/merged = what the agent sees (union of lower + upper)

if mountpoint -q /workspace/merged 2>/dev/null; then
  echo "[sandbox] OverlayFS already mounted"
else
  echo "[sandbox] Mounting overlayfs..."
  fuse-overlayfs \
    -o lowerdir=/workspace/lower \
    -o upperdir=/workspace/upper \
    -o workdir=/workspace/work \
    /workspace/merged || {
      echo "[sandbox] fuse-overlayfs failed, falling back to bind mount"
      mount --bind /workspace/lower /workspace/merged 2>/dev/null || \
        cp -a /workspace/lower/. /workspace/merged/ 2>/dev/null || true
    }
fi

# --- Git staging repo ---
STAGING_REPO="${GIT_STAGING_REPO:-/data/git-staging.git}"

if [ ! -d "$STAGING_REPO" ]; then
  echo "[sandbox] Creating git staging repo at $STAGING_REPO"
  git init --bare "$STAGING_REPO"
fi

# Set up the workspace as a git repo pointing to the staging repo
cd /workspace/merged
if [ ! -d .git ]; then
  git init
  git remote add origin "$STAGING_REPO"
  # If there's existing content, create an initial commit
  if [ -n "$(ls -A)" ]; then
    git add -A
    git config user.email "sandbox@local"
    git config user.name "Sandbox Agent"
    git commit -m "Initial sandbox state" --allow-empty
    git push -u origin HEAD 2>/dev/null || true
  fi
else
  # Ensure origin points to staging repo
  git remote set-url origin "$STAGING_REPO" 2>/dev/null || \
    git remote add origin "$STAGING_REPO" 2>/dev/null || true
fi

# Git config for the agent
git config user.email "agent@sandbox"
git config user.name "Sandbox Agent"

# --- Environment ---
export HTTP_PROXY="${HTTP_PROXY:-http://host.docker.internal:3701}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://host.docker.internal:3701}"
export SANDBOX_API="${SANDBOX_API:-http://host.docker.internal:3700}"
export OVERLAY_UPPER="/workspace/upper"
export HOST_PROJECT="/workspace/lower"
export GIT_STAGING_REPO="$STAGING_REPO"

echo "[sandbox] Environment ready:"
echo "  Workspace: /workspace/merged"
echo "  Overlay upper: /workspace/upper"
echo "  Git staging: $STAGING_REPO"
echo "  HTTP proxy: $HTTP_PROXY"
echo "  Sandbox API: $SANDBOX_API"
echo ""

# --- Run the agent ---
if [ $# -eq 0 ]; then
  echo "[sandbox] No command specified. Starting interactive shell."
  exec /bin/bash
else
  echo "[sandbox] Running: $@"
  exec "$@"
fi
