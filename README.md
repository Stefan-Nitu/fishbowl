# sandbox

Safety container for self-evolving AI agents. The agent can read anything, write freely inside its sandbox, but any effect on the outside world requires human approval.

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
│                             ▼                    │
│  ┌─────────────────────────────────────────┐     │
│  │  /workspace (overlayfs)                 │     │
│  │  ├── lower: host project (read-only)    │     │
│  │  ├── upper: agent writes (captured)     │     │
│  │  └── merged: what agent sees            │     │
│  │                                         │     │
│  │  Agent process (any AI agent)           │     │
│  │  HTTP_PROXY → host proxy                │     │
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

An AI agent runs inside a Docker container with an overlayfs filesystem. It sees the host project as read-only and all writes go to a separate layer. Network traffic goes through an HTTP proxy. Everything the agent wants to do outside the sandbox goes through an approval queue.

**The agent keeps evolving while waiting.** Approvals are async — the agent doesn't block.

**The agent can propose changes to its own sandbox rules.** These go through the `sandbox` category and always require individual human approval.

## Permission Categories

| Category | What needs approval | Granularity |
|---|---|---|
| `network` | HTTP requests to hosts not in the allowlist | Per-request or bulk per domain |
| `filesystem` | Syncing agent's file changes to the host | Per-file or bulk |
| `git` | Pushing from the staging repo to the real remote | Per-branch |
| `packages` | Installing new packages | Per-package |
| `sandbox` | Changing sandbox config (allowlist, modes) | Always individual |

Each category has a mode: `approve-each`, `approve-bulk`, `allow-all`, or `deny-all`. Set in `sandbox.config.json`.

## Git Inside the Sandbox

All git operations inside the container are free. The agent's `origin` points to a local bare staging repo — commits, branches, pushes are instant and safe. Getting changes to the real remote is a `git` category approval, so the human can review the diff before it leaves the sandbox.

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
| `GET` | `/api/sync/files` | List changed files in overlay |
| `POST` | `/api/sync/files` | Request file sync to host |
| `GET` | `/api/sync/git` | List unsynced branches |
| `POST` | `/api/sync/git` | Request git sync to real remote |

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
    "sandbox": { "mode": "approve-each" }
  }
}
```

## Docker

```sh
# Full stack
docker compose up

# Run a specific agent command
docker compose run agent bun run my-agent.ts

# Mount a specific project into the sandbox
HOST_PROJECT=/path/to/project docker compose up
```

The container gets:
- **overlayfs**: host project read-only, agent writes captured separately
- **git staging**: local bare repo as `origin`, free to commit/push/branch
- **HTTP proxy**: all outbound traffic routed through the approval proxy
- **SANDBOX_API**: environment variable pointing to the permission server

## Project Structure

```
src/
  types.ts         Shared types
  queue.ts         Async permission queue with persistence
  config.ts        Sandbox config management
  proxy.ts         HTTP/HTTPS proxy with allowlist
  server.ts        Permission server (Bun.serve)
  sync.ts          File sync from container overlay to host
  git-sync.ts      Git staging repo → real remote sync
  cli.ts           Terminal approval tool
ui/
  index.html       Web dashboard
  app.tsx          React dashboard app
  styles.css       Dashboard styles
container/
  entrypoint.sh    Docker entrypoint (overlayfs, git staging, proxy env)
  sdk.ts           Agent SDK
tests/
  queue.test.ts    Queue tests
  config.test.ts   Config tests
  proxy.test.ts    Proxy logic tests
```

## License

MIT
