import { isEndpointAllowed, getCategoryMode, loadConfig } from "./config";
import { queue } from "./queue";
import type { Socket } from "bun";

const PROXY_PORT = parseInt(process.env.PROXY_PORT || "3701", 10);

async function handleConnect(req: Request): Promise<Response> {
  const url = new URL(`http://${req.headers.get("host") || req.url}`);
  const targetHost = url.hostname || req.url.split(":")[0];
  const targetPort = parseInt(url.port || "443", 10);

  if (isEndpointAllowed(targetHost)) {
    // Allowed — will be handled by the upgrade
    return new Response(null, { status: 200 });
  }

  const mode = getCategoryMode("network");

  if (mode === "allow-all") {
    return new Response(null, { status: 200 });
  }

  if (mode === "deny-all") {
    return new Response("Blocked by sandbox policy", { status: 403 });
  }

  // Queue a permission request
  const { id, promise } = queue.request(
    "network",
    `CONNECT ${targetHost}:${targetPort}`,
    `HTTPS connection to ${targetHost}:${targetPort}`,
    `Agent requested HTTPS tunnel to ${targetHost}`
  );

  const approved = await promise;
  if (approved) {
    return new Response(null, { status: 200 });
  }
  return new Response(`Denied by sandbox (request ${id})`, { status: 403 });
}

async function handleHttp(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const targetHost = url.hostname;

  if (isEndpointAllowed(targetHost)) {
    return fetch(req);
  }

  const mode = getCategoryMode("network");

  if (mode === "allow-all") {
    return fetch(req);
  }

  if (mode === "deny-all") {
    return new Response("Blocked by sandbox policy", { status: 403 });
  }

  const { id, promise } = queue.request(
    "network",
    `${req.method} ${url.origin}${url.pathname}`,
    `HTTP ${req.method} to ${targetHost}${url.pathname}`,
    `Agent requested HTTP access to ${targetHost}`
  );

  const approved = await promise;
  if (approved) {
    return fetch(req);
  }
  return new Response(`Denied by sandbox (request ${id})`, { status: 403 });
}

export function startProxy(port = PROXY_PORT) {
  // For HTTPS CONNECT tunneling, we use a raw TCP server approach.
  // Bun.serve handles the HTTP proxy requests; CONNECT requires socket-level handling.

  const server = Bun.serve({
    port,
    async fetch(req) {
      // Regular HTTP proxy requests have absolute URLs
      if (req.method === "CONNECT") {
        return handleConnect(req);
      }

      // Check if this is a proxy request (absolute URL)
      const url = new URL(req.url);
      if (url.hostname && url.hostname !== "localhost" && url.port !== String(port)) {
        return handleHttp(req);
      }

      return new Response("AI Sandbox Proxy\n", { status: 200 });
    },
  });

  console.log(`[proxy] HTTP proxy listening on :${server.port}`);
  return server;
}

if (import.meta.main) {
  await loadConfig();
  await queue.init();
  startProxy();
}
