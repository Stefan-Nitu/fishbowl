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
