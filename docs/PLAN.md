# fishbowl — Project Plan

## Current Status

All six permission categories implemented. Live workspace sync mirrors agent changes to host in real-time. Graceful shutdown ensures no work is lost. "Always Deny" complements "Always Allow" for persistent rules.

## Completed

- ✅ Permission queue with persistence and WebSocket broadcast
- ✅ Sandbox config management (categories, modes, endpoints)
- ✅ HTTP/HTTPS proxy with allowlist + queue integration
- ✅ Host command execution (exec category, approve-each only)
- ✅ File sync from container overlay to host
- ✅ Git staging repo → real remote sync
- ✅ CLI (approve/deny/watch mode)
- ✅ Web dashboard (queue, config, history, rules tabs)
- ✅ Docker compose stack (server + proxy + agent container)
- ✅ Rules engine — pattern-based allow/deny rules with deny-first precedence
- ✅ "Always Allow" — approve + auto-generate rule from request context
- ✅ Filesystem apply-on-approve (Write/Edit with stale detection)
- ✅ Queue superseding — same-file auto-denies previous pending
- ✅ Packages category — hardened like exec, parses bun/npm/pip/cargo commands
- ✅ Audit log — append-only JSONL at `data/audit.log`, fire-and-forget from queue.resolve()
- ✅ Rule persistence — verified save/load round-trip with dedicated tests
- ✅ Agent SDK docs (`container/README.md`)
- ✅ Max uptime / TTL — `MAX_UPTIME` env var, auto-shutdown with pending denial
- ✅ Status endpoint — `GET /api/status` with uptime/remaining info
- ✅ E2E integration tests (HTTP + WebSocket, full queue lifecycle)
- ✅ Docker smoke test script (`tests/e2e-docker.sh`)
- ✅ "Always Deny" — deny + auto-generate deny rule from request context
- ✅ Live workspace sync — `fs.watch` mirrors `/workspace/merged` → `/workspace/lower` in real-time
- ✅ Graceful shutdown — SIGTERM/SIGINT/MAX_UPTIME do `fullSync()` before exit
- ✅ Shared workspace volume — sandbox-server and agent share `/workspace/merged`
- ✅ Default deny rule for `*.datadoghq.com` (Bun telemetry)

## Next Steps

- [ ] Web UI: Files tab showing agent's changed files in workspace
- [ ] Rate limiting / abuse prevention on permission endpoints
- [ ] Web UI: show uptime/TTL countdown in dashboard header
- [ ] Web UI: audit log viewer tab
- [ ] Structured logging with levels (replace console.log)
- [ ] Container health checks in Docker compose
- [ ] Agent SDK: WebSocket mode (avoid polling overhead)

## Key Decisions

- **Deny-first rule evaluation**: deny rules always checked before allow. No rule match → falls through to category mode.
- **Bare `exec`/`packages` allow rules ignored**: `exec(*)` and `packages(*)` are silently skipped — blanket allow is too dangerous for these categories.
- **Filesystem uses path-aware globs**: `Bun.Glob` for filesystem rules (`*` = one segment, `**` = recursive). All other categories use simple glob where `*` matches anything.
- **Packages hardened like exec**: always `approve-each`, mode change blocked, bare allow rule ignored.
- **Audit is fire-and-forget**: `appendAudit()` in `queue.resolve()` doesn't block the approval flow. Best-effort persistence.
- **Max uptime uses env var**: `MAX_UPTIME=4h` is simpler than config — it's an operational concern, not a sandbox policy.
- **Stale edit detection**: `applyFilesystemRequest` checks `old_string` exists in file before applying. Returns error if stale.
- **Superseding**: only filesystem requests with matching `targetFile` are superseded. Other categories queue independently.
- **Live sync over approval-based sync**: agent's workspace is mirrored to host continuously — the sandbox gates actions (network, exec, packages), not file output. Approval-based file sync was too cumbersome and meant work could be lost if the container died.
- **Sandbox-server owns the sync**: only the sandbox-server has write access to `/workspace/lower`. The agent container keeps it read-only. Sync runs in the server process via `fs.watch` with 300ms debounce.
- **`rsync` for full sync, `cp` for incremental**: `fullSync()` uses `rsync --delete` for a complete mirror. The file watcher uses per-file `cp`/`rm` for speed.
