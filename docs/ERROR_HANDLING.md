# Error Handling

## Filesystem Apply Errors

`applyFilesystemRequest` returns `{ ok: boolean; error?: string }` rather than throwing:

```typescript
// Stale edit — old_string not found in file
{ ok: false, error: "old_string not found in file — edit is stale" }

// File doesn't exist for Edit
{ ok: false, error: "Target file does not exist — edit is stale" }

// Missing metadata
{ ok: false, error: "No writeContent in metadata" }
```

When apply fails, the server denies the request and returns a 409 to the client:

```typescript
if (!applyResult.ok) {
  queue.deny(id, resolvedBy);
  return Response.json({ ok: false, error: applyResult.error }, { status: 409 });
}
```

## Exec / Package Errors

Commands that fail (non-zero exit, timeout) are captured in `result`:

```typescript
{ stdout: "", stderr: "error message", exitCode: -1 }
```

Timeouts get `exitCode: 124` and `[timed out]` appended to stderr. The request status is `"failed"` (not `"denied"`).

## Rule Validation

`addRule` validates via `parseRule` before adding. Invalid rules return `false` and are not persisted:

```typescript
const added = addRule("allow", "invalid(pattern)");
// added === false — "invalid" is not a valid category
```

Valid categories: `network`, `filesystem`, `git`, `packages`, `sandbox`, `exec`.

## Config Load Fallback

If `sandbox.config.json` fails to parse, the config falls back to `DEFAULT_CONFIG`. Missing `rules` field is patched in on load:

```typescript
if (!current.rules) current.rules = { allow: [], deny: [] };
```

## Audit Log Resilience

`appendAudit` wraps all I/O in try/catch — audit failures are silently swallowed:

```typescript
export async function appendAudit(entry: AuditEntry): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort — don't block the main flow
  }
}
```

`readAuditLog` returns `[]` on any error (missing file, parse errors). Malformed JSONL lines are skipped.

## Package Command Safety

`parsePackageCommand` filters unsafe flags — only a whitelist of safe flags (`-D`, `--dev`, `--exact`, `--global`, `--save`) pass through. Unknown flags like `--registry=evil.com` are silently dropped.

## Duration Parsing

`parseDuration` returns `null` for invalid input rather than throwing. The server only sets up the uptime timer if parsing succeeds:

```typescript
const maxUptimeMs = process.env.MAX_UPTIME ? parseDuration(process.env.MAX_UPTIME) : null;
// maxUptimeMs is null if MAX_UPTIME is unset or unparseable
```
