# Concurrency Patterns

## Permission Queue

`PermissionQueue` uses an async promise-per-request pattern. Each `queue.request()` returns `{ id, promise }` where the promise resolves when a human approves or denies:

```typescript
const { id, promise } = queue.request("exec", command, reason);
// ... promise hangs until human acts ...
const approved = await promise;
```

Multiple requests resolve independently — `Promise.all` is used for batch file sync:

```typescript
await Promise.all(
  pending.map(async ({ file, promise }) => {
    const approved = await promise;
    if (approved) await syncFile(file.path);
  })
);
```

## Superseding

Only one pending request per `targetFile` is allowed. New requests auto-deny the old:

```typescript
// ✅ Safe: second write to same file supersedes first
queue.request("filesystem", "Write foo.ts", ..., { targetFile: "src/foo.ts" });
queue.request("filesystem", "Write foo.ts", ..., { targetFile: "src/foo.ts" });
// First request is immediately denied with resolvedBy: "auto"

// ✅ Different files queue independently
queue.request("filesystem", "Write foo.ts", ..., { targetFile: "src/foo.ts" });
queue.request("filesystem", "Write bar.ts", ..., { targetFile: "src/bar.ts" });
// Both remain pending
```

Only filesystem requests are superseded. Other categories (exec, network, packages, etc.) always queue independently.

## WebSocket Broadcast

State changes are broadcast to all connected WebSocket clients immediately after mutation. The pattern is always: mutate → persist → broadcast:

```typescript
const added = addRule(type, rule);
if (added) {
  await saveConfig();          // persist first
  broadcast("rules", getRules()); // then notify clients
}
```

## Stale Detection

Filesystem edits can go stale between request time and approval time (the agent may have made further changes). `applyFilesystemRequest` checks before applying:

- **Edit**: verifies `old_string` still exists in the file
- **Write**: always succeeds (full file replacement)

If stale, the request is denied with an error rather than silently corrupting.

## Fire-and-Forget Audit

`appendAudit()` in `queue.resolve()` is intentionally not awaited — audit logging should never block the approval flow:

```typescript
// ✅ Fire-and-forget: resolve() returns immediately
appendAudit({ timestamp, id, category, ... });

// ❌ Would block approval while writing to disk
await appendAudit({ ... });
```

## Live Sync File Watcher

`startLiveSync()` uses `fs.watch` with `recursive: true` and a debounced flush:

```typescript
// Changes are batched in a Set, flushed after 300ms of quiet
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

watcher = watch(WORKSPACE, { recursive: true }, (_event, filename) => {
  if (!filename || shouldSkip(filename)) return;
  pending.add(filename);
  if (!timer) timer = setTimeout(flush, 300);
});
```

The debounce prevents per-character syncing when the agent writes large files. The `Set` deduplicates rapid changes to the same file.

## Graceful Shutdown

All shutdown paths (SIGTERM, SIGINT, MAX_UPTIME) go through `gracefulShutdown()`:

1. Stop file watcher (prevent new syncs during shutdown)
2. Run `fullSync()` — `rsync --delete` for a complete mirror
3. Deny all pending requests (clean denials, not hanging promises)
4. Broadcast shutdown event to WebSocket clients
5. `process.exit(0)`

The `fullSync()` is awaited — shutdown blocks until the final sync completes. This ensures no agent work is lost.

## Workspace Initialization Race

The sandbox-server starts before the agent (`depends_on` in Docker Compose). The shared workspace volume is empty until the agent's entrypoint copies files in. `startLiveSync()` polls every 2s for `.git/HEAD` before starting the watcher — avoids watching an empty directory.
