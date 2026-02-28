#!/usr/bin/env bash
set -euo pipefail

# Smoke test: spin up the full Docker stack, hit endpoints, tear down.

echo "=== fishbowl Docker e2e smoke test ==="

cleanup() {
  echo "--- Tearing down ---"
  docker compose down --timeout 5 2>/dev/null || true
}
trap cleanup EXIT

echo "--- Starting stack ---"
docker compose up -d --build

# Wait for server to be ready
echo "--- Waiting for server ---"
for i in $(seq 1 30); do
  if curl -sf http://localhost:3700/api/config > /dev/null 2>&1; then
    echo "Server ready after ${i}s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "FAIL: Server not ready after 30s"
    docker compose logs
    exit 1
  fi
  sleep 1
done

# Check config endpoint
echo "--- GET /api/config ---"
CONFIG=$(curl -sf http://localhost:3700/api/config)
echo "$CONFIG" | grep -q "allowedEndpoints" || { echo "FAIL: missing allowedEndpoints"; exit 1; }
echo "OK"

# Check queue endpoint
echo "--- GET /api/queue ---"
QUEUE=$(curl -sf http://localhost:3700/api/queue)
echo "$QUEUE" | grep -q "pending" || { echo "FAIL: missing pending"; exit 1; }
echo "OK"

# Submit a request
echo "--- POST /api/queue ---"
SUBMIT=$(curl -sf -X POST http://localhost:3700/api/queue \
  -H "Content-Type: application/json" \
  -d '{"category":"network","action":"CONNECT test.com:443","description":"smoke test"}')
ID=$(echo "$SUBMIT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Submitted request: $ID"

# Approve it
echo "--- POST /api/queue/$ID/approve ---"
APPROVE=$(curl -sf -X POST "http://localhost:3700/api/queue/${ID}/approve" \
  -H "Content-Type: application/json" \
  -d '{"resolvedBy":"web"}')
echo "$APPROVE" | grep -q '"ok":true' || { echo "FAIL: approve failed"; exit 1; }
echo "OK"

# Check rules endpoint
echo "--- GET /api/rules ---"
RULES=$(curl -sf http://localhost:3700/api/rules)
echo "$RULES" | grep -q "allow" || { echo "FAIL: missing allow"; exit 1; }
echo "OK"

# Check audit endpoint
echo "--- GET /api/audit ---"
sleep 1  # Let audit write complete
AUDIT=$(curl -sf "http://localhost:3700/api/audit?limit=10")
echo "$AUDIT" | grep -q "$ID" || { echo "FAIL: audit entry missing"; exit 1; }
echo "OK"

echo ""
echo "=== All smoke tests passed ==="
