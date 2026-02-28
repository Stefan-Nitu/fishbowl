# Testing

## Running Tests

```sh
bun test              # all tests
bun test tests/rules  # specific file
```

## Test Files

| File | Covers |
|---|---|
| `tests/rules.test.ts` | Rule parsing, pattern matching, evaluation, generation, safety guards |
| `tests/config.test.ts` | Config loading, category modes, endpoint CRUD, rule CRUD |
| `tests/config-persistence.test.ts` | Save/load round-trip for rules, endpoints, category modes |
| `tests/packages.test.ts` | Package command parsing, flag filtering, category hardening, queue flow |
| `tests/audit.test.ts` | JSONL write/read round-trip, limit, field persistence |
| `tests/uptime.test.ts` | Duration parsing (`4h`, `30m`, `1h30m`), formatting |
| `tests/sync.test.ts` | Filesystem apply (Write/Edit), stale detection, queue superseding |
| `tests/e2e.test.ts` | Full HTTP/WebSocket integration (spawns real server) |
| `tests/e2e-docker.sh` | Docker compose smoke test (shell script) |

## Test Style

Tests use Arrange/Act/Assert with comments where the phases aren't obvious:

```typescript
test("evaluateRules: deny beats allow when both match", () => {
  // Arrange
  const rules: RuleSet = {
    allow: ["network(*.example.com)"],
    deny: ["network(evil.example.com)"],
  };
  // Act & Assert
  expect(evaluateRules(rules, "network", "evil.example.com")).toBe("deny");
});
```

For straightforward tests, skip the comments — the code speaks for itself:

```typescript
test("parseRule parses bare category as wildcard", () => {
  const r = parseRule("network");
  expect(r).toEqual({ category: "network", pattern: "*" });
});
```

## Persistence Tests

`tests/config-persistence.test.ts` saves and restores `sandbox.config.json` in `afterEach` to avoid pollution:

```typescript
afterEach(async () => {
  if (savedContent) {
    await Bun.write(CONFIG_PATH, savedContent);
    await loadConfig();
  }
});
```

## E2E Tests

`tests/e2e.test.ts` spawns a real server subprocess on a random port with `PROXY_INLINE=false`:

```typescript
server = Bun.spawn(["bun", "run", "src/server.ts"], {
  env: { ...process.env, SERVER_PORT: String(PORT), PROXY_INLINE: "false" },
});
await waitForReady(`${BASE}/api/config`);
```

Uses `setDefaultTimeout(15_000)` to allow for server startup time.

Covers: queue lifecycle, deny flow, rules CRUD, always-allow, exec/packages endpoints, config, WebSocket init, audit log, status endpoint.

## Filesystem Tests

`tests/sync.test.ts` tests against the actual filesystem using a temp directory under `WORKSPACE`. These tests require `/workspace/merged` to exist (works inside the Docker container). They fail with EROFS outside Docker — this is expected.

## What to Test

- Rule parsing edge cases (empty patterns, invalid categories)
- Pattern matching across categories (filesystem path-aware vs simple glob)
- Deny-first precedence
- Safety guards (bare exec/packages allow ignored)
- Category hardening (exec/packages refuse mode changes)
- Package command parsing (bun/npm/pip/cargo, unsafe flag filtering)
- Stale edit detection (file changed between request and approval)
- Queue superseding (same targetFile auto-denies previous)
- Config save/load round-trips
- Audit log write/read/limit
- Duration parsing edge cases
