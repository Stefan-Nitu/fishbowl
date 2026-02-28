# Code Patterns

## Rule Format

Rules follow the pattern `category(glob_pattern)`:

```
network(*.example.com)    — allow/deny requests to *.example.com
exec(bun test *)          — match any bun test command
filesystem(src/**)        — recursive match under src/
git(main)                 — match the main branch
packages(npm install *)   — match npm install commands
exec(rm -rf *)            — match destructive rm commands
```

A bare category name (e.g. `network`) expands to `category(*)` — matches everything in that category.

### Glob Semantics

- **Filesystem**: uses `Bun.Glob` (path-aware). `*` = one path segment, `**` = recursive.
- **Everything else**: simple glob where `*` matches anything including `/` and spaces.

```typescript
// ✅ Filesystem: use ** for recursive
"filesystem(src/**)"      // matches src/foo/bar/baz.ts

// ❌ Filesystem: * only matches one segment
"filesystem(src/*)"       // does NOT match src/foo/bar.ts

// ✅ Non-filesystem: * matches anything
"exec(bun test *)"        // matches "bun test src/foo/bar.ts"
```

## Rule Evaluation Order

```
1. Deny rules checked first → deny wins
2. Allow rules checked second → allow if match
3. No match → null → fall through to category mode
```

### Safety: Hardened Categories

`exec` and `packages` have extra safety guards:

```typescript
// ✅ Specific allow rules work fine
"exec(bun test *)"         // allowed — specific command
"packages(bun add zod)"    // allowed — specific package

// ❌ Blanket allow rules — silently ignored
"exec"                     // equivalent to exec(*), too dangerous
"packages"                 // equivalent to packages(*), too dangerous
```

## Adding Approval Checks to New Features

When integrating a new action type with the permission pipeline:

```typescript
// ✅ Correct: rules first, then category mode fallback
const verdict = evaluateRules(getRules(), category, matchTarget);
if (verdict === "deny") return blocked();
if (verdict === "allow") return proceed();
// No rule matched — fall through to category mode
const mode = getCategoryMode(category);
// ... handle mode ...

// ❌ Wrong: checking category mode before rules
const mode = getCategoryMode(category);  // rules never consulted
```

## Hardened Category Pattern

`exec` and `packages` are hardened — always `approve-each`, no mode override:

```typescript
// In config.ts:
export function getCategoryMode(category: Category): ApprovalMode {
  if (category === "exec" || category === "packages") return "approve-each";
  return current.categories[category]?.mode ?? "approve-each";
}

export function setCategoryMode(category: Category, mode: ApprovalMode): void {
  if ((category === "exec" || category === "packages") && mode !== "approve-each") return;
  current.categories[category] = { mode };
}
```

When adding a new hardened category, update both functions + the `evaluateRules` safety check in `rules.ts`.

## Queue Request with Metadata

When queueing filesystem requests, include metadata for the approval flow:

```typescript
// ✅ Include toolName + targetFile for superseding and apply-on-approve
queue.request("filesystem", `Write ${path}`, reason, undefined, {
  toolName: "Write",
  targetFile: relativePath,
  writeContent: content,
});

// ✅ Edit requests need editContext for stale detection
queue.request("filesystem", `Edit ${path}`, reason, undefined, {
  toolName: "Edit",
  targetFile: relativePath,
  editContext: { old_string, new_string },
});
```

## Server Endpoint Pattern

REST endpoints in `server.ts` use method-keyed route objects for static paths and regex matching in `fetch()` for parameterized paths:

```typescript
// Static routes
"/api/rules": {
  GET: () => Response.json(getRules()),
  POST: async (req) => { /* ... */ },
  DELETE: async (req) => { /* ... */ },
},

// Parameterized routes (in fetch handler)
const execMatch = url.pathname.match(/^\/api\/exec\/([^/]+)$/);
if (execMatch && req.method === "GET") { /* ... */ }
```

## Fire-and-Forget Audit

Audit logging uses fire-and-forget — never blocks the main flow:

```typescript
// ✅ In queue.resolve(): fire-and-forget, no await
appendAudit({ timestamp, id, category, action, decision, ... });

// ❌ Don't await audit — it shouldn't block approvals
await appendAudit(...);  // blocks the resolve flow unnecessarily
```
