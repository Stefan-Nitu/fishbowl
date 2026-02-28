# Dev Notes

## Rules Engine

### Filesystem Glob vs Simple Glob

Filesystem rules use `Bun.Glob` which is path-aware: `*` matches a single path segment, `**` matches recursively. All other categories use a simple regex conversion where `*` matches anything.

This matters: `exec(bun test *)` matches `bun test src/foo/bar.ts` but `filesystem(src/*)` does NOT match `src/foo/bar.ts`.

### Bare Allow Safety for exec and packages

`evaluateRules` silently skips `exec(*)` and `packages(*)` allow rules. This prevents accidental blanket allow from the "Always Allow" flow. The rules are stored but never matched.

### generateRule Heuristics

`generateRule` extracts smart patterns from raw action strings:
- Network: extracts hostname → `*.domain.com` (or exact IP)
- Filesystem: extracts directory → `dir/*`
- Exec: uses exact command string
- Git: uses branch name
- Packages: uses exact action string

## Filesystem Approval Flow

### Apply-on-Approve

Filesystem writes/edits are applied at approval time, not at request time. The content is stored in `metadata.writeContent` / `metadata.editContext` and applied by `applyFilesystemRequest()` when the human clicks Approve.

### Stale Edit Detection

If the file has changed between when the agent requested the edit and when the human approves, the `old_string` won't be found and the edit fails with a stale error. The request is denied rather than silently applying a wrong edit.

## Queue Superseding

Only filesystem requests with matching `metadata.targetFile` are superseded. The check runs synchronously during `queue.request()` before the new request ID is assigned. The old request's promise resolves as `false` (denied) immediately.

## Packages Category

Mirrors exec pattern — hardened with approve-each always. `parsePackageCommand()` detects bun/npm/pip/cargo install patterns and filters unsafe flags (only `-D`, `--dev`, `--exact`, `--global`, `--save` etc. pass through). Unknown flags are silently dropped for safety.

## WebSocket message Handler

The WebSocket `message` handler in `server.ts` must be `async` because `applyFilesystemRequest()` is async. This was a bug that was fixed — if it's not `async`, the `await` inside the handler causes a compile error that silently prevents the server from starting.

## Max Uptime

`MAX_UPTIME` is an env var, not a config field. It's an operational concern (how long should this session run?) not a sandbox policy. Using env var means Docker compose, systemd, or shell scripts can set it without touching config files.

`parseDuration` accepts: `4h`, `30m`, `1h30m`, `2h15m30s`, `500ms`, or bare milliseconds (`14400000`).

## Audit Log Format

JSONL at `data/audit.log`. One line per resolved request. Read in reverse for most-recent-first. `appendAudit()` is fire-and-forget — uses try/catch to never block the queue resolve flow.

## Live Sync

### Volume Architecture

Both containers share a `workspace` Docker volume. The sandbox-server has `/workspace/lower` (host bind mount) read-write; the agent has it read-only. This means only the server can write to the host — the agent's file changes flow through the shared volume → watcher → host.

### fs.watch Gotchas

`fs.watch` with `recursive: true` works on macOS (FSEvents) and Linux 5.9+ (fanotify). The watcher skips `.git/` and `node_modules/` to avoid noise. Changes are debounced at 300ms to batch rapid writes.

### fullSync vs incremental

`fullSync()` uses `rsync -a --delete` — it's a complete mirror that also removes files deleted in the workspace. The incremental watcher uses `cp` for creates/updates and `rm -f` for deletes. `fullSync` runs at startup and on shutdown; the watcher handles everything in between.

### Bun Telemetry

Bun sends telemetry to `*.datadoghq.com` via HTTPS. Since the agent container routes all traffic through the proxy, this shows up as `CONNECT http-intake.logs.us5.datadoghq.com:443`. Denied by default via a deny rule in `sandbox.config.json`.

### Workspace Initialization Race

The sandbox-server starts before the agent (Docker Compose `depends_on`). The workspace volume is empty until the agent's `entrypoint.sh` copies files into it. `startLiveSync()` polls for `/workspace/merged/.git/HEAD` every 2s before starting the watcher.
