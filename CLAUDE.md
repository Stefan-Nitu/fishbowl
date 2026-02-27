AI Sandbox — Safety container for self-evolving AI agents.

## Running

```sh
bun run server    # Permission server (REST + WS + Web UI) on :3700
bun run proxy     # HTTP proxy on :3701
bun run cli       # Interactive CLI for approving/denying requests
bun test          # Run tests
docker compose up # Full stack: server + proxy + agent container
```

## Architecture

- `src/types.ts` — Shared types
- `src/queue.ts` — Async permission queue with persistence
- `src/config.ts` — Sandbox config management
- `src/proxy.ts` — HTTP/HTTPS proxy with allowlist + queue
- `src/server.ts` — Permission server (Bun.serve)
- `src/sync.ts` — File sync from container overlay to host
- `src/git-sync.ts` — Git staging repo → real remote sync
- `src/cli.ts` — Terminal approval tool
- `ui/` — React web dashboard
- `container/` — Docker entrypoint + agent SDK
