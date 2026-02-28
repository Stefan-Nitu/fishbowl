# fishbowl — Project Plan

## Current Status

All six permission categories are implemented with real approval flows. Rules engine, audit log, packages category, and max uptime are complete. E2E tests cover the full HTTP/WebSocket API.

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

## Next Steps

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
