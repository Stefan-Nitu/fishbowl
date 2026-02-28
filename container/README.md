# fishbowl Agent SDK

Lightweight client SDK for agents running inside the sandbox container. Communicates with the fishbowl permission server via REST API polling.

## Setup

```ts
import { sandbox } from "./sdk";
```

The SDK reads `SANDBOX_API` from the environment (defaults to `http://localhost:3700`).

## API Reference

### `sandbox.requestPermission(category, action, reason?, metadata?)`

Submit a generic permission request to the queue.

- **category**: `"network" | "filesystem" | "git" | "packages" | "sandbox" | "exec"`
- **action**: what you want to do (e.g., `"fetch https://example.com"`)
- **reason**: optional human-readable justification
- **metadata**: optional key-value metadata
- **Returns**: `Promise<boolean>` — true if approved, false if denied

```ts
const allowed = await sandbox.requestPermission(
  "network",
  "fetch https://api.github.com/repos",
  "Need to check repo metadata"
);
```

### `sandbox.requestExec(command, reason?, cwd?)`

Request execution of a shell command on the host.

- **command**: the shell command to run
- **reason**: optional justification
- **cwd**: optional working directory
- **Returns**: `Promise<ExecResult>` — `{ stdout, stderr, exitCode }`
- **Throws**: if the request is denied

```ts
const result = await sandbox.requestExec("bun test", "Run test suite");
console.log(result.stdout);
```

### `sandbox.requestPackageInstall(manager, packages, reason?)`

Request installation of packages on the host.

- **manager**: `"bun" | "npm" | "pip" | "cargo"`
- **packages**: array of package names
- **reason**: optional justification
- **Returns**: `Promise<PackageResult>` — `{ stdout, stderr, exitCode }`
- **Throws**: if the request is denied

```ts
const result = await sandbox.requestPackageInstall(
  "bun",
  ["zod", "hono"],
  "Need HTTP framework and validation"
);
```

### `sandbox.proposeConfigChange(path, value, reason)`

Propose a change to the sandbox configuration. Goes through the permission queue.

- **path**: dot-separated config path (e.g., `"categories.network.mode"`)
- **value**: the new value
- **reason**: justification for the change
- **Returns**: `Promise<boolean>`

```ts
await sandbox.proposeConfigChange(
  "categories.network.mode",
  "allow-all",
  "Need unrestricted network for downloading datasets"
);
```

### `sandbox.listPending()`

List all pending permission requests.

- **Returns**: `Promise<QueueItem[]>`

### `sandbox.getConfig()`

Fetch the current sandbox configuration.

- **Returns**: `Promise<Record<string, unknown>>`

## Complete Example

```ts
import { sandbox } from "./sdk";

// 1. Check if we can reach the API we need
const networkOk = await sandbox.requestPermission(
  "network",
  "fetch https://registry.npmjs.org",
  "Need to check package versions"
);

if (networkOk) {
  // 2. Install a package
  const installResult = await sandbox.requestPackageInstall(
    "bun",
    ["cheerio"],
    "Need HTML parser for scraping"
  );
  console.log("Install:", installResult.exitCode === 0 ? "success" : "failed");

  // 3. Run a command
  const testResult = await sandbox.requestExec("bun test", "Verify everything works");
  console.log("Tests:", testResult.exitCode === 0 ? "passed" : "failed");
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SANDBOX_API` | `http://localhost:3700` | Permission server URL |
| `WORKSPACE` | `/workspace/merged` | Container workspace path |

## How It Works

The SDK uses a **polling model**:

1. Submit a request via `POST /api/queue` (or `/api/exec`, `/api/packages`)
2. Receive a request ID
3. Poll the server every 500ms until the request is resolved
4. Return the result (approved/denied)

This design avoids WebSocket complexity in the agent and works reliably across container boundaries.

## Rules

The permission server supports pattern-based allow/deny rules that auto-resolve requests without human intervention:

- **Allow rules**: `network(*.github.com)`, `exec(bun test *)`, `filesystem(src/**)`
- **Deny rules**: `exec(rm -rf *)`, `filesystem(.env*)`
- Deny rules are checked first — deny always wins over allow
- Bare `exec` and `packages` allow rules (match-all) are ignored as a safety measure
- Rules can be created via the "Always Allow" button in the UI or the CLI

When a rule matches, the request is auto-resolved without queuing for human approval.
