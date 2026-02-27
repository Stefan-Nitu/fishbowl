import { queue } from "./queue";
import { loadConfig, getConfig, saveConfig, applyConfigChange, addAllowedEndpoint } from "./config";
import { listChangedFiles, requestFileSync } from "./sync";
import { listUnsyncedBranches, requestGitSync } from "./git-sync";
import { startProxy } from "./proxy";
import { submitExec, getExecRequest } from "./exec";
import type { Category, ConfigChangeProposal, PermissionRequest } from "./types";
import index from "../ui/index.html";

const PORT = parseInt(process.env.SERVER_PORT || "3700", 10);

type WSData = { id: string };
const wsClients = new Set<ReturnType<typeof server.upgrade extends (r: any, o: any) => infer R ? never : any>>();
// We'll track WebSocket connections via the websocket handlers below.
const sockets = new Set<any>();

function broadcast(type: string, data: unknown) {
  const msg = JSON.stringify({ type, data });
  for (const ws of sockets) {
    try {
      ws.send(msg);
    } catch {}
  }
}

// Wire up queue events for real-time broadcast
queue.on("request", (req) => broadcast("request", req));
queue.on("resolve", (req) => broadcast("resolve", req));

const server = Bun.serve<WSData>({
  port: PORT,
  routes: {
    "/": index,

    // --- Queue endpoints ---
    "/api/queue": {
      GET: () => {
        const pending = queue.pending();
        const recent = queue.recent();
        return Response.json({ pending, recent });
      },
      POST: async (req) => {
        const body = await req.json();
        const { category, action, description, reason, metadata } = body as {
          category: Category;
          action: string;
          description: string;
          reason?: string;
          metadata?: Record<string, unknown>;
        };
        const { id } = queue.request(category, action, description, reason, metadata);
        return Response.json({ id }, { status: 201 });
      },
    },

    "/api/queue/bulk": {
      POST: async (req) => {
        const { category, status, resolvedBy } = (await req.json()) as {
          category: Category;
          status: "approved" | "denied";
          resolvedBy?: "cli" | "web";
        };
        const count = queue.bulkResolve(category, status, resolvedBy || "web");
        return Response.json({ count });
      },
    },

    // --- Config endpoints ---
    "/api/config": {
      GET: () => Response.json(getConfig()),
    },

    "/api/config/propose": {
      POST: async (req) => {
        const proposal = (await req.json()) as ConfigChangeProposal;
        const { id } = queue.request(
          "sandbox",
          `config change: ${proposal.path}`,
          `Proposed config change: ${proposal.path} = ${JSON.stringify(proposal.value)}`,
          proposal.reason,
          { proposal }
        );
        return Response.json({ id }, { status: 201 });
      },
    },

    // --- Sync endpoints ---
    "/api/sync/files": {
      GET: async () => {
        const files = await listChangedFiles();
        return Response.json({ files });
      },
      POST: async (req) => {
        const { paths } = (await req.json()) as { paths?: string[] };
        const allFiles = await listChangedFiles();
        const toSync = paths
          ? allFiles.filter((f) => paths.includes(f.path))
          : allFiles;
        const results = await requestFileSync(toSync);
        return Response.json({
          results: Object.fromEntries(results),
        });
      },
    },

    "/api/sync/git": {
      GET: async () => {
        const branches = await listUnsyncedBranches();
        return Response.json({ branches });
      },
      POST: async (req) => {
        const { branch } = (await req.json()) as { branch: string };
        const approved = await requestGitSync(branch);
        return Response.json({ branch, approved });
      },
    },

    // --- Exec endpoints ---
    "/api/exec": {
      POST: async (req) => {
        const { command, cwd, reason, timeout } = (await req.json()) as {
          command: string;
          cwd?: string;
          reason?: string;
          timeout?: number;
        };
        if (!command) {
          return Response.json({ error: "command is required" }, { status: 400 });
        }
        const execReq = await submitExec(command, cwd, reason, timeout);
        return Response.json({ id: execReq.id }, { status: 201 });
      },
    },
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // Handle exec result lookup
    const execMatch = url.pathname.match(/^\/api\/exec\/([^/]+)$/);
    if (execMatch && req.method === "GET") {
      const execReq = getExecRequest(execMatch[1]);
      if (!execReq) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(execReq);
    }

    // Handle queue item approve/deny with path params
    const queueMatch = url.pathname.match(/^\/api\/queue\/([^/]+)\/(approve|deny)$/);
    if (queueMatch && req.method === "POST") {
      const [, id, action] = queueMatch;
      const body = await req.json().catch(() => ({}));
      const resolvedBy = (body as any)?.resolvedBy || "web";

      if (action === "approve") {
        const ok = queue.approve(id, resolvedBy);

        // If this was a sandbox config proposal, apply it
        const request = queue.get(id);
        if (ok && request?.category === "sandbox" && request.metadata?.proposal) {
          const proposal = request.metadata.proposal as ConfigChangeProposal;
          applyConfigChange(proposal);
          await saveConfig();
        }

        return Response.json({ ok });
      } else {
        const ok = queue.deny(id, resolvedBy);
        return Response.json({ ok });
      }
    }

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: { id: crypto.randomUUID() },
      });
      if (upgraded) return undefined as any;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      sockets.add(ws);
      // Send current state on connect
      ws.send(
        JSON.stringify({
          type: "init",
          data: {
            pending: queue.pending(),
            config: getConfig(),
          },
        })
      );
    },
    message(ws, message) {
      // Clients can send commands via WebSocket too
      try {
        const msg = JSON.parse(String(message));
        if (msg.type === "approve") queue.approve(msg.id, "web");
        else if (msg.type === "deny") queue.deny(msg.id, "web");
      } catch {}
    },
    close(ws) {
      sockets.delete(ws);
    },
  },

  development: {
    hmr: true,
    console: true,
  },
});

console.log(`[server] Permission server listening on :${server.port}`);

// Initialize
await loadConfig();
await queue.init();

// Optionally start proxy in same process
if (process.env.PROXY_INLINE !== "false") {
  startProxy();
}
