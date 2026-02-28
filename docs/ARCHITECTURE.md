# Architecture

## Overview

fishbowl is a permission gateway that sits between an AI agent (running in a Docker container) and the host system. Every action the agent takes — network requests, file writes, command execution, git pushes, package installs — must pass through fishbowl's approval pipeline.

```
┌──────────────┐     ┌─────────────────────────────┐     ┌──────────┐
│  AI Agent    │────>│  fishbowl                    │────>│  Host     │
│  (container) │     │  server :3700 + proxy :3701  │     │  System   │
└──────────────┘     └─────────────────────────────┘     └──────────┘
                            │          ▲
                      ┌─────▼──────────┤
                      │  Human Operator │
                      │  (CLI / Web UI) │
                      └─────────────────┘
```

## Permission Pipeline

Every request flows through three layers in order:

1. **Static allowlist** — `allowedEndpoints` in config (network only, always allowed)
2. **Rules engine** — pattern-based allow/deny rules, deny-first. Returns `allow`, `deny`, or `null` (no match)
3. **Category mode** — `approve-each`, `approve-bulk`, `allow-all`, or `deny-all`

If rules return a verdict, it short-circuits — category mode is never consulted.

Hardened categories (`exec`, `packages`) are always `approve-each` regardless of config, and bare allow rules (`exec(*)`, `packages(*)`) are silently ignored.

## Module Map

```
src/types.ts      Shared types: Category, RuleSet, SandboxConfig, PermissionRequest
src/queue.ts      Async permission queue — enqueue, resolve, persist, broadcast, audit hook
src/config.ts     Config loading/saving, category modes, rule CRUD
src/rules.ts      Rule parsing, pattern matching, evaluation, rule generation
src/proxy.ts      HTTP/HTTPS proxy — intercepts agent traffic, checks allowlist → rules → queue
src/server.ts     Bun.serve HTTP + WebSocket — REST API, serves web UI, max uptime timer
src/exec.ts       Host command execution — rules check → queue → spawn process
src/packages.ts   Package install — parses bun/npm/pip/cargo, rules check → queue → run
src/audit.ts      Append-only JSONL audit log — appendAudit() + readAuditLog()
src/uptime.ts     Duration parsing (4h, 30m) and formatting, used by max uptime feature
src/sync.ts       File sync — overlay diff detection, rules check → queue → copy to host
src/git-sync.ts   Git branch sync — staging repo → real remote, rules check → queue → push
src/cli.ts        Terminal UI — approve/deny/watch/rules management

ui/app.tsx        React SPA — queue, rules, config, history tabs
ui/styles.css     Dashboard styles
ui/index.html     Entry point (served by Bun)

container/sdk.ts  Agent-facing SDK (requestPermission, requestExec, requestPackageInstall)
container/README.md  SDK documentation
```

## Data Flow: Package Install

```
Agent calls sandbox.requestPackageInstall("bun", ["zod"])
  → POST /api/packages → submitPackageRequest()
  → evaluateRules(rules, "packages", "bun install zod")
    → "deny" → return denied
    → "allow" → run immediately
    → null → queue.request() (always approve-each)
      → Human approves → buildCommand() → runPackageCommand()
      → Human denies → return denied
```

## Data Flow: "Always Allow"

```
Human clicks "Always Allow" on a pending request
  → server approves the request
  → generateRule(category, action) → e.g. "network(*.example.com)"
  → addRule("allow", rule) → persisted to sandbox.config.json
  → broadcast("rules", ...) → all connected clients update
  → future matching requests auto-allowed by rules engine
```

## Audit Trail

Every `queue.resolve()` call fires `appendAudit()` (fire-and-forget). Entries are written as JSONL to `data/audit.log` with: timestamp, request ID, category, action, decision, resolvedBy, durationMs, metadata.

`GET /api/audit?limit=N` reads the log in reverse order (most recent first).

## Max Uptime

`MAX_UPTIME` env var (e.g., `4h`, `30m`, `1h30m`) schedules auto-shutdown. On expiry: all pending requests are denied, a `shutdown` event is broadcast to WebSocket clients, and the process exits.

`GET /api/status` returns `{ startedAt, uptime, maxUptimeMs, remainingMs }`.

## Queue Superseding

When a new filesystem request targets the same file as a pending one, the old request is auto-denied with `resolvedBy: "auto"`. This prevents stale approval of outdated writes.
