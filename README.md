# fishbowl

Safety container for self-evolving AI agents. The agent can read anything, write freely inside its fishbowl, but any effect on the outside world requires human approval.

```
┌─────────────────────────────────────────────────┐
│  HOST                                           │
│                                                 │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │  CLI Tool     │  │  Permission Server      │  │
│  │  (approve/    │◄─┤  (Bun.serve)            │  │
│  │   deny)       │  │  - REST API             │  │
│  └──────────────┘  │  - WebSocket (realtime)  │  │
│                     │  - Web Dashboard         │  │
│  ┌──────────────┐  │  - Queue + Config mgmt   │  │
│  │  Web UI       │◄─┤  - Audit log            │  │
│  │  (browser)    │  └────────┬────────────────┘  │
│  └──────────────┘           │                    │
│                     ┌───────┴────────┐           │
│                     │  HTTP Proxy     │           │
│                     │  (allowlist +   │           │
│                     │   queue)        │           │
│                     └───────┬────────┘           │
├─────────────────────────────┼───────────────────┤
│  DOCKER CONTAINER           │                    │
│  (internal network only)    ▼                    │
│  ┌─────────────────────────────────────────┐     │
│  │  /workspace/merged (git-tracked copy)   │     │
│  │  ├── lower: host project (read-only)    │     │
│  │  └── merged: writable copy (git diff)   │     │
│  │                                         │     │
│  │  Agent process (any AI agent)           │     │
│  │  No direct internet access              │     │
│  │  SANDBOX_API → permission server        │     │
│  └─────────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
```

## Quick Start

```sh
bun install

# Start permission server (REST + WebSocket + Web UI on :3700, proxy on :3701)
bun run server

# In another terminal — interactive CLI
bun run cli watch

# Or use Docker for the full setup
docker compose up
```

Open http://localhost:3700 for the web dashboard.

## How It Works

An AI agent runs inside a Docker container on an isolated internal network. The host project is copied into the workspace and tracked with git. Network traffic goes through the permission server's proxy. Everything the agent wants to do outside the fishbowl goes through an approval queue.

**The agent keeps evolving while waiting.** Approvals are async — the agent doesn't block.

**The agent can propose changes to its own sandbox rules.** These go through the `sandbox` category and always require individual human approval.

**The agent can request host command execution.** These go through the `exec` category and always require individual approval — no bulk or auto-approve.

## Permission Categories

| Category | What needs approval | Mode |
|---|---|---|
| `network` | HTTP requests to hosts not in the allowlist | Configurable |
| `filesystem` | Syncing agent's file changes to the host | Configurable |
| `git` | Pushing from the staging repo to the real remote | Configurable |
| `packages` | Installing packages (bun/npm/pip/cargo) | Always approve-each |
| `sandbox` | Changing sandbox config (allowlist, modes) | Always approve-each |
| `exec` | Executing commands on the host | Always approve-each |

Each category has a mode: `approve-each`, `approve-bulk`, `allow-all`, or `deny-all`. The `exec` and `packages` categories are locked to `approve-each` and cannot be overridden.

## Rules

Pattern-based rules auto-approve or auto-deny requests without human intervention:

```sh
# Allow all requests to GitHub
network(*.github.com)

# Allow bun test commands
exec(bun test *)

# Deny destructive commands
exec(rm -rf *)

# Allow recursive file sync under src/
filesystem(src/**)

# Block .env files
filesystem(.env*)
```

Rules are persisted in `sandbox.config.json`. Deny rules are checked first — deny always beats allow. Bare `exec` and `packages` allow rules (match-all) are silently ignored as a safety measure.

Click "Always Allow" on any request to auto-generate a rule from its context.

## Max Uptime

Set a time limit for the fishbowl session:

```sh
MAX_UPTIME=4h bun run server     # Shut down after 4 hours
MAX_UPTIME=30m bun run server    # 30 minutes
MAX_UPTIME=1h30m bun run server  # 1.5 hours
```

On expiry, all pending requests are denied, WebSocket clients are notified, and the process exits. Check remaining time via `GET /api/status`.

## Git Inside the Sandbox

All git operations inside the container are free. The agent's `origin` points to a local bare staging repo — commits, branches, pushes are instant and safe. Getting changes to the real remote is a `git` category approval, so the human can review the diff before it leaves the fishbowl.

## Agent SDK

Agents can use the optional SDK or just `fetch()` against `SANDBOX_API`:

```ts
import { sandbox } from "./sdk";

// Request permission (blocks until approved/denied)
const ok = await sandbox.requestPermission(
  "network",
  "GET https://example.com/data.json",
  "Need training data"
);

// Install packages (requires individual approval)
const pkg = await sandbox.requestPackageInstall(
  "bun",
  ["zod", "hono"],
  "Need HTTP framework and validation"
);

// Execute a command on the host (requires individual approval)
const result = await sandbox.requestExec(
  "bun test",
  "Need to run tests on host"
);
console.log(result.stdout, result.exitCode);

// Propose a sandbox config change
await sandbox.proposeConfigChange(
  "allowedEndpoints",
  ["api.anthropic.com", "api.openai.com"],
  "Need access to OpenAI for comparison benchmarks"
);
```

See [`container/README.md`](container/README.md) for full SDK documentation.

## API

### REST

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/queue` | List pending and recent requests |
| `POST` | `/api/queue` | Submit a permission request |
| `POST` | `/api/queue/:id/approve` | Approve a request (optional `alwaysAllow` flag) |
| `POST` | `/api/queue/:id/deny` | Deny a request |
| `POST` | `/api/queue/bulk` | Bulk approve/deny by category |
| `GET` | `/api/config` | Current sandbox config |
| `POST` | `/api/config/propose` | Agent proposes a config change |
| `GET` | `/api/rules` | List all rules |
| `POST` | `/api/rules` | Add a rule |
| `DELETE` | `/api/rules` | Remove a rule |
| `GET` | `/api/sync/files` | List changed files in workspace |
| `POST` | `/api/sync/files` | Request file sync to host |
| `GET` | `/api/sync/git` | List unsynced branches |
| `POST` | `/api/sync/git` | Request git sync to real remote |
| `POST` | `/api/exec` | Submit exec request |
| `GET` | `/api/exec/:id` | Get exec status/result |
| `POST` | `/api/packages` | Submit package install request |
| `GET` | `/api/packages/:id` | Get package request status |
| `GET` | `/api/audit?limit=N` | Read audit log (most recent first) |
| `GET` | `/api/status` | Server uptime and TTL info |

### WebSocket

Connect to `/ws` for real-time updates. Messages are JSON with `type` field:

- **Server → Client**: `init` (state on connect), `request` (new), `resolve` (approved/denied), `rules` (changed), `shutdown` (TTL expired)
- **Client → Server**: `approve` / `deny` with `id` field, optional `alwaysAllow`

### CLI

```sh
bun run cli list                    # List pending requests
bun run cli approve req-0           # Approve a request
bun run cli deny req-1              # Deny a request
bun run cli approve --all network   # Approve all network requests
bun run cli watch                   # Interactive mode with live updates
bun run cli rules                   # List all rules
bun run cli allow "exec(bun test *)" # Add allow rule
```

## Configuration

`sandbox.config.json`:

```json
{
  "allowedEndpoints": ["api.anthropic.com"],
  "gitStagingRepo": "/data/git-staging.git",
  "rules": { "allow": [], "deny": [] },
  "categories": {
    "network": { "mode": "approve-each" },
    "filesystem": { "mode": "approve-each" },
    "git": { "mode": "approve-each" },
    "packages": { "mode": "approve-each" },
    "sandbox": { "mode": "approve-each" },
    "exec": { "mode": "approve-each" }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `3700` | Permission server port |
| `PROXY_PORT` | `3701` | HTTP proxy port |
| `PROXY_INLINE` | `true` | Run proxy in same process as server |
| `MAX_UPTIME` | _(none)_ | Auto-shutdown after duration (e.g., `4h`, `30m`) |
| `WORKSPACE` | `/workspace/merged` | Container workspace path |
| `HOST_PROJECT` | `/workspace/lower` | Host project mount path |
| `SANDBOX_API` | `http://localhost:3700` | SDK: permission server URL |

## Docker

```sh
# Full stack
docker compose up

# Run a specific agent command
docker compose run agent bun run my-agent.ts

# Mount a specific project into the fishbowl
HOST_PROJECT=/path/to/project docker compose up
```

The container gets:
- **Internal network**: agent can only reach the permission server, not the internet
- **Git-tracked workspace**: host project copied in, changes tracked via git diff
- **Git staging**: local bare repo as `origin`, free to commit/push/branch
- **HTTP proxy**: outbound traffic routed through the approval proxy
- **SANDBOX_API**: environment variable pointing to the permission server

## Security

- **No `SYS_ADMIN` capability** — agent container runs with minimal privileges
- **Internal network only** — agent cannot reach the internet directly
- **Proxy enforced at network level** — agent cannot bypass the proxy
- **`exec` and `packages` locked to approve-each** — host commands and package installs always require individual human approval
- **Deny-first rules** — deny rules always win over allow rules
- **Bare exec/packages allow rules ignored** — `exec(*)` and `packages(*)` are silently skipped
- **Audit trail** — every permission decision logged to `data/audit.log`
- **Max uptime** — optional session TTL prevents runaway agents

## Project Structure

```
src/
  types.ts         Shared types (Category, RuleSet, SandboxConfig, etc.)
  queue.ts         Async permission queue with persistence + audit hook
  config.ts        Sandbox config management + rule CRUD
  rules.ts         Rule parsing, matching, evaluation, generation
  proxy.ts         HTTP/HTTPS proxy with allowlist
  server.ts        Permission server (REST + WebSocket + max uptime)
  exec.ts          Host command execution (approve-each only)
  packages.ts      Package install (bun/npm/pip/cargo, approve-each only)
  audit.ts         Append-only JSONL audit log
  uptime.ts        Duration parsing (4h, 30m) and formatting
  sync.ts          File sync from container to host
  git-sync.ts      Git staging repo → real remote sync
  cli.ts           Terminal approval tool
ui/
  index.html       Web dashboard entry point
  app.tsx          React dashboard app
  styles.css       Dashboard styles
container/
  entrypoint.sh    Docker entrypoint (workspace copy, git init)
  sdk.ts           Agent SDK
  README.md        SDK documentation
tests/
  config.test.ts            Config unit tests
  config-persistence.test.ts  Save/load round-trip tests
  rules.test.ts             Rules engine tests
  packages.test.ts          Package parsing + hardening tests
  audit.test.ts             Audit log tests
  uptime.test.ts            Duration parsing tests
  sync.test.ts              Filesystem sync tests
  e2e.test.ts               Full integration tests
  e2e-docker.sh             Docker smoke test
docs/
  ARCHITECTURE.md  System design
  PLAN.md          Project status and roadmap
  PATTERNS.md      Code conventions
  TESTING.md       Test approach
  DEV_NOTES.md     Implementation notes
  CONCURRENCY.md   Async patterns
  ERROR_HANDLING.md Error strategies
  LOGGING.md       Logging and monitoring
```

## License

MIT
