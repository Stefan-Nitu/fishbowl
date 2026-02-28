# Logging

## Console Output

fishbowl uses `console.log` with prefix tags:

```
[server] Permission server listening on :3700
[server] Max uptime: 4h — will shut down at 2026-02-28T22:03:14.049Z
[server] Shutting down: SIGTERM
[server] Final sync complete (42 files)
[sync] Live mirror started: /workspace/merged → /workspace/lower
[sync] Initial sync: 5 changed files
[proxy] HTTP proxy listening on :3701
```

## WebSocket Events

All state changes are broadcast as JSON over WebSocket:

| Event Type | Payload | When |
|---|---|---|
| `init` | `{ pending, config, rules }` | Client connects |
| `request` | `PermissionRequest` | New request queued |
| `resolve` | `PermissionRequest` | Request approved/denied |
| `rules` | `RuleSet` | Rule added/removed |
| `shutdown` | `{ reason }` | SIGTERM, SIGINT, or max uptime |

## Audit Log

Persistent JSONL at `data/audit.log`. One line per resolved permission request:

```json
{"timestamp":1772301234000,"id":"req-42","category":"exec","action":"bun test","decision":"approved","resolvedBy":"web","durationMs":5678,"metadata":{}}
```

Read via `GET /api/audit?limit=N` (most recent first).

## CLI Output

The CLI uses ANSI color codes for visual feedback:

- Green (`\x1b[32m`) — allow/approve indicators
- Red (`\x1b[31m`) — deny indicators
- Blue (`\x1b[34m`) — "always allow" confirmation
- Bold (`\x1b[1m`) — request categories and IDs
