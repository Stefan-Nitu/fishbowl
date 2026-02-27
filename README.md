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
│  │  Web UI       │◄─┤  - File sync (approved) │  │
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

| Category | What needs approval | Granularity |
|---|---|---|
| `network` | HTTP requests to hosts not in the allowlist | Per-request or bulk per domain |
| `filesystem` | Syncing agent's file changes to the host | Per-file or bulk |
| `git` | Pushing from the staging repo to the real remote | Per-branch |
| `packages` | Installing new packages | Per-package |
| `sandbox` | Changing sandbox config (allowlist, modes) | Always individual |
| `exec` | Executing commands on the host | Always individual |

Each category has a mode: `approve-each`, `approve-bulk`, `allow-all`, or `deny-all`. Set in `sandbox.config.json`. The `exec` category is locked to `approve-each` and cannot be overridden.

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

## API

### REST

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/queue` | List pending and recent requests |
| `POST` | `/api/queue` | Submit a permission request |
| `POST` | `/api/queue/:id/approve` | Approve a request |
| `POST` | `/api/queue/:id/deny` | Deny a request |
| `POST` | `/api/queue/bulk` | Bulk approve/deny by category |
| `GET` | `/api/config` | Current sandbox config |
| `POST` | `/api/config/propose` | Agent proposes a config change |
| `GET` | `/api/sync/files` | List changed files in workspace |
| `POST` | `/api/sync/files` | Request file sync to host |
| `GET` | `/api/sync/git` | List unsynced branches |
| `POST` | `/api/sync/git` | Request git sync to real remote |
| `POST` | `/api/exec` | Submit exec request (returns `{ id }`) |
| `GET` | `/api/exec/:id` | Get exec result |

### WebSocket

Connect to `/ws` for real-time updates. Messages are JSON with `type` field:

- **Server → Client**: `init` (current state on connect), `request` (new request), `resolve` (request resolved)
- **Client → Server**: `approve` / `deny` with `id` field

### CLI

```sh
bun run cli list                    # List pending requests
bun run cli approve req-0           # Approve a request
bun run cli deny req-1              # Deny a request
bun run cli approve --all network   # Approve all network requests
bun run cli watch                   # Interactive mode with live updates
```

## Configuration

`sandbox.config.json`:

```json
{
  "allowedEndpoints": ["api.anthropic.com"],
  "gitStagingRepo": "/data/git-staging.git",
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
- **HTTP proxy**: outbound traffic routed through the approval proxy (via permission server)
- **SANDBOX_API**: environment variable pointing to the permission server

## Security

- **No `SYS_ADMIN` capability** — agent container runs with minimal privileges
- **Internal network only** — agent cannot reach the internet directly; all traffic goes through the permission server
- **Proxy enforced at network level** — agent cannot bypass the proxy by unsetting env vars
- **`exec` locked to approve-each** — host command execution always requires individual human approval, cannot be overridden

## Project Structure

```
src/
  types.ts         Shared types
  queue.ts         Async permission queue with persistence
  config.ts        Sandbox config management
  proxy.ts         HTTP/HTTPS proxy with allowlist
  server.ts        Permission server (Bun.serve)
  exec.ts          Host command execution (approve-each only)
  sync.ts          File sync from container to host
  git-sync.ts      Git staging repo → real remote sync
  cli.ts           Terminal approval tool
ui/
  index.html       Web dashboard
  app.tsx          React dashboard app
  styles.css       Dashboard styles
container/
  entrypoint.sh    Docker entrypoint (workspace copy, git init)
  sdk.ts           Agent SDK
tests/
  queue.test.ts    Queue tests
  config.test.ts   Config tests
  proxy.test.ts    Proxy logic tests
  exec.test.ts     Exec tests
```

## License

MIT
