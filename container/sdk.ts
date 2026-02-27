/**
 * Lightweight client SDK for agents running inside the sandbox.
 * Communicates with the permission server via SANDBOX_API env var.
 *
 * Usage:
 *   import { sandbox } from "./sdk";
 *   const approved = await sandbox.requestPermission("network", "fetch https://example.com", "Need to download data");
 */

const API = process.env.SANDBOX_API || "http://localhost:3700";

export type Category = "network" | "filesystem" | "git" | "packages" | "sandbox";

interface PermissionResponse {
  id: string;
}

interface QueueItem {
  id: string;
  status: "pending" | "approved" | "denied";
  category: string;
  action: string;
}

async function requestPermission(
  category: Category,
  action: string,
  reason?: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  const res = await fetch(`${API}/api/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category,
      action,
      description: action,
      reason,
      metadata,
    }),
  });

  const { id } = (await res.json()) as PermissionResponse;

  // Poll until resolved
  while (true) {
    await Bun.sleep(500);
    const poll = await fetch(`${API}/api/queue`);
    const { pending, recent } = (await poll.json()) as {
      pending: QueueItem[];
      recent: QueueItem[];
    };

    const item = [...pending, ...recent].find((r) => r.id === id);
    if (!item || item.status === "pending") continue;
    return item.status === "approved";
  }
}

async function proposeConfigChange(
  path: string,
  value: unknown,
  reason: string
): Promise<boolean> {
  const res = await fetch(`${API}/api/config/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, value, reason }),
  });

  const { id } = (await res.json()) as PermissionResponse;

  while (true) {
    await Bun.sleep(500);
    const poll = await fetch(`${API}/api/queue`);
    const { pending, recent } = (await poll.json()) as {
      pending: QueueItem[];
      recent: QueueItem[];
    };

    const item = [...pending, ...recent].find((r) => r.id === id);
    if (!item || item.status === "pending") continue;
    return item.status === "approved";
  }
}

async function listPending(): Promise<QueueItem[]> {
  const res = await fetch(`${API}/api/queue`);
  const { pending } = (await res.json()) as { pending: QueueItem[] };
  return pending;
}

async function getConfig(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/api/config`);
  return res.json();
}

export const sandbox = {
  requestPermission,
  proposeConfigChange,
  listPending,
  getConfig,
};

export default sandbox;
