import { queue } from "./queue";
import { loadConfig, getConfig, saveConfig, applyConfigChange, addAllowedEndpoint, getRules, addRule, removeRule } from "./config";
import { listChangedFiles, requestFileSync, applyFilesystemRequest, startLiveSync, stopLiveSync, fullSync } from "./sync";
import { listUnsyncedBranches, requestGitSync } from "./git-sync";
import { startProxy } from "./proxy";
import { submitExec, getExecRequest } from "./exec";
import { submitPackageRequest, getPackageRequest } from "./packages";
import { readAuditLog } from "./audit";
import { generateRule, evaluateRules, extractNetworkHost } from "./rules";
import { parseDuration, formatDuration } from "./uptime";
import type { Category, ConfigChangeProposal, PermissionRequest } from "./types";
import index from "../ui/index.html";

const PORT = parseInt(process.env.SERVER_PORT || "3700", 10);
const startedAt = Date.now();
const maxUptimeMs = process.env.MAX_UPTIME ? parseDuration(process.env.MAX_UPTIME) : null;

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

function getMatchTarget(req: PermissionRequest): string {
  if (req.category === "network") return extractNetworkHost(req.action) || req.action;
  if (req.category === "filesystem") return req.action.replace(/^sync\s+/, "");
  return req.action;
}

function autoResolveMatching(status: "approved" | "denied") {
  const rules = getRules();
  for (const req of queue.pending()) {
    const verdict = evaluateRules(rules, req.category, getMatchTarget(req));
    if (verdict === (status === "approved" ? "allow" : "deny")) {
      queue.resolve(req.id, status, "auto");
    }
  }
}

// Wire up queue events for real-time broadcast
queue.on("request", (req) => broadcast("request", req));
queue.on("resolve", (req) => broadcast("resolve", req));

const server = Bun.serve<WSData>({
  port: PORT,
  idleTimeout: 255,
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

    // --- Rules endpoints ---
    "/api/rules": {
      GET: () => Response.json(getRules()),
      POST: async (req) => {
        const { type, rule } = (await req.json()) as { type: "allow" | "deny"; rule: string };
        if (!type || !rule) {
          return Response.json({ error: "type and rule are required" }, { status: 400 });
        }
        const added = addRule(type, rule);
        if (added) {
          await saveConfig();
          broadcast("rules", getRules());
        }
        return Response.json({ added, rules: getRules() });
      },
      DELETE: async (req) => {
        const { type, rule } = (await req.json()) as { type: "allow" | "deny"; rule: string };
        const removed = removeRule(type, rule);
        if (removed) {
          await saveConfig();
          broadcast("rules", getRules());
        }
        return Response.json({ removed, rules: getRules() });
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

    // --- Packages endpoints ---
    "/api/packages": {
      POST: async (req) => {
        const { manager, packages, action, reason, cwd, timeout } = (await req.json()) as {
          manager: string;
          packages: string[];
          action?: "install" | "add" | "remove";
          reason?: string;
          cwd?: string;
          timeout?: number;
        };
        if (!manager || !packages?.length) {
          return Response.json({ error: "manager and packages are required" }, { status: 400 });
        }
        const pkgReq = await submitPackageRequest(manager, packages, action || "install", reason, cwd, timeout);
        return Response.json({ id: pkgReq.id }, { status: 201 });
      },
    },

    // --- Status endpoint ---
    "/api/status": {
      GET: () => {
        const now = Date.now();
        const uptimeMs = now - startedAt;
        return Response.json({
          startedAt,
          uptime: formatDuration(uptimeMs),
          maxUptimeMs: maxUptimeMs ?? null,
          maxUptime: maxUptimeMs ? formatDuration(maxUptimeMs) : null,
          remainingMs: maxUptimeMs ? Math.max(0, maxUptimeMs - uptimeMs) : null,
          remaining: maxUptimeMs ? formatDuration(Math.max(0, maxUptimeMs - uptimeMs)) : null,
        });
      },
    },

    // --- Audit endpoints ---
    "/api/audit": {
      GET: async (req) => {
        const url = new URL(req.url);
        const limit = parseInt(url.searchParams.get("limit") || "100", 10);
        const entries = await readAuditLog(limit);
        return Response.json(entries);
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

    // Handle packages result lookup
    const pkgMatch = url.pathname.match(/^\/api\/packages\/([^/]+)$/);
    if (pkgMatch && req.method === "GET") {
      const pkgReq = getPackageRequest(pkgMatch[1]);
      if (!pkgReq) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(pkgReq);
    }

    // Handle queue item approve/deny with path params
    const queueMatch = url.pathname.match(/^\/api\/queue\/([^/]+)\/(approve|deny)$/);
    if (queueMatch && req.method === "POST") {
      const [, id, action] = queueMatch;
      const body = await req.json().catch(() => ({}));
      const resolvedBy = (body as any)?.resolvedBy || "web";

      if (action === "approve") {
        const request = queue.get(id);

        // Filesystem requests: apply the write/edit before marking approved
        if (request?.category === "filesystem" && request.metadata?.toolName) {
          const applyResult = await applyFilesystemRequest(request);
          if (!applyResult.ok) {
            // Stale or failed — deny instead of approve
            queue.deny(id, resolvedBy);
            return Response.json({ ok: false, error: applyResult.error }, { status: 409 });
          }
        }

        const ok = queue.approve(id, resolvedBy);

        if (ok && request?.category === "sandbox" && request.metadata?.proposal) {
          const proposal = request.metadata.proposal as ConfigChangeProposal;
          applyConfigChange(proposal);
          await saveConfig();
        }

        // "Always allow" — generate and persist a rule, auto-approve matching
        if (ok && (body as any)?.alwaysAllow && request) {
          const rule = generateRule(request.category, request.action);
          if (addRule("allow", rule)) {
            await saveConfig();
            broadcast("rules", getRules());
            autoResolveMatching("approved");
          }
        }

        return Response.json({ ok });
      } else {
        const request = queue.get(id);
        const ok = queue.deny(id, resolvedBy);

        if (ok && (body as any)?.alwaysDeny && request) {
          const rule = generateRule(request.category, request.action);
          if (addRule("deny", rule)) {
            await saveConfig();
            broadcast("rules", getRules());
            autoResolveMatching("denied");
          }
        }

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
            rules: getRules(),
          },
        })
      );
    },
    async message(ws, message) {
      try {
        const msg = JSON.parse(String(message));
        if (msg.type === "approve") {
          const request = queue.get(msg.id);
          // Apply filesystem writes/edits before approving
          if (request?.category === "filesystem" && request.metadata?.toolName) {
            const applyResult = await applyFilesystemRequest(request);
            if (!applyResult.ok) {
              queue.deny(msg.id, "web");
              ws.send(JSON.stringify({ type: "error", id: msg.id, error: applyResult.error }));
              return;
            }
          }
          queue.approve(msg.id, "web");
          if (msg.alwaysAllow) {
            if (request) {
              const rule = generateRule(request.category, request.action);
              if (addRule("allow", rule)) {
                saveConfig();
                broadcast("rules", getRules());
                autoResolveMatching("approved");
              }
            }
          }
        } else if (msg.type === "deny") {
          const request = queue.get(msg.id);
          queue.deny(msg.id, "web");
          if (msg.alwaysDeny && request) {
            const rule = generateRule(request.category, request.action);
            if (addRule("deny", rule)) {
              saveConfig();
              broadcast("rules", getRules());
              autoResolveMatching("denied");
            }
          }
        }
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

// Live mirror: sync agent workspace to host
startLiveSync();

async function gracefulShutdown(reason: string) {
  console.log(`[server] Shutting down: ${reason}`);
  stopLiveSync();
  const synced = await fullSync();
  console.log(`[server] Final sync complete (${synced} files)`);
  for (const req of queue.pending()) {
    queue.deny(req.id, "auto");
  }
  broadcast("shutdown", { reason });
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Max uptime auto-shutdown
if (maxUptimeMs) {
  console.log(`[server] Max uptime: ${formatDuration(maxUptimeMs)} — will shut down at ${new Date(startedAt + maxUptimeMs).toISOString()}`);
  setTimeout(() => gracefulShutdown("max uptime reached"), maxUptimeMs);
}
