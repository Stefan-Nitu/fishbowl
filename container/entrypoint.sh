#!/bin/bash
set -e

echo "[sandbox] Setting up sandbox environment..."

# --- Copy-based workspace ---
# /workspace/lower = read-only host project (bind mounted)
# /workspace/merged = writable copy the agent works on (tracked via git)

echo "[sandbox] Copying project to workspace..."
cp -a /workspace/lower/. /workspace/merged/

# --- Git tracking in workspace ---
cd /workspace/merged
git config user.email "agent@sandbox"
git config user.name "Sandbox Agent"

if [ ! -d .git ]; then
  git init
  git add -A
  git commit -m "Initial sandbox state" --allow-empty
fi

# --- Git staging repo ---
STAGING_REPO="${GIT_STAGING_REPO:-/data/git-staging.git}"

if [ ! -d "$STAGING_REPO" ]; then
  echo "[sandbox] Creating git staging repo at $STAGING_REPO"
  git init --bare "$STAGING_REPO"
fi

# Point origin to staging repo
git remote set-url origin "$STAGING_REPO" 2>/dev/null || \
  git remote add origin "$STAGING_REPO" 2>/dev/null || true
git push -u origin HEAD 2>/dev/null || true

# --- Environment ---
export SANDBOX_API="${SANDBOX_API:-http://sandbox-server:3700}"
export WORKSPACE="/workspace/merged"
export GIT_STAGING_REPO="$STAGING_REPO"

echo "[sandbox] Environment ready:"
echo "  Workspace: /workspace/merged"
echo "  Git staging: $STAGING_REPO"
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
