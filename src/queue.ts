import { EventEmitter } from "events";
import type { PermissionRequest, Category, RequestStatus, QueueEvents } from "./types";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const QUEUE_FILE = DATA_DIR + "queue.json";

type Resolver = (approved: boolean) => void;

export class PermissionQueue extends EventEmitter<QueueEvents> {
  private requests: Map<string, PermissionRequest> = new Map();
  private waiters: Map<string, Resolver> = new Map();
  private counter = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
  }

  async init() {
    try {
      const file = Bun.file(QUEUE_FILE);
      if (await file.exists()) {
        const data: PermissionRequest[] = await file.json();
        for (const req of data) {
          this.requests.set(req.id, req);
          const num = parseInt(req.id.split("-")[1] || "0", 10);
          if (num >= this.counter) this.counter = num + 1;
        }
      }
    } catch {
      // Start fresh
    }
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 100);
  }

  private async persist() {
    const all = Array.from(this.requests.values());
    await Bun.write(QUEUE_FILE, JSON.stringify(all, null, 2));
  }

  private nextId(): string {
    return `req-${this.counter++}`;
  }

  request(
    category: Category,
    action: string,
    description: string,
    reason?: string,
    metadata?: Record<string, unknown>
  ): { id: string; promise: Promise<boolean> } {
    const id = this.nextId();
    const req: PermissionRequest = {
      id,
      category,
      action,
      description,
      reason,
      status: "pending",
      metadata,
      createdAt: Date.now(),
    };
    this.requests.set(id, req);
    this.schedulePersist();
    this.emit("request", req);

    const promise = new Promise<boolean>((resolve) => {
      this.waiters.set(id, resolve);
    });

    return { id, promise };
  }

  resolve(id: string, status: "approved" | "denied", resolvedBy?: "cli" | "web" | "auto") {
    const req = this.requests.get(id);
    if (!req || req.status !== "pending") return false;

    req.status = status;
    req.resolvedAt = Date.now();
    req.resolvedBy = resolvedBy;
    this.schedulePersist();
    this.emit("resolve", req);

    const waiter = this.waiters.get(id);
    if (waiter) {
      waiter(status === "approved");
      this.waiters.delete(id);
    }
    return true;
  }

  approve(id: string, resolvedBy?: "cli" | "web" | "auto") {
    return this.resolve(id, "approved", resolvedBy);
  }

  deny(id: string, resolvedBy?: "cli" | "web" | "auto") {
    return this.resolve(id, "denied", resolvedBy);
  }

  bulkResolve(
    category: Category,
    status: "approved" | "denied",
    resolvedBy?: "cli" | "web" | "auto"
  ): number {
    let count = 0;
    for (const req of this.requests.values()) {
      if (req.category === category && req.status === "pending") {
        this.resolve(req.id, status, resolvedBy);
        count++;
      }
    }
    return count;
  }

  poll(id: string): PermissionRequest | undefined {
    return this.requests.get(id);
  }

  pending(): PermissionRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status === "pending");
  }

  recent(limit = 50): PermissionRequest[] {
    return Array.from(this.requests.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  get(id: string): PermissionRequest | undefined {
    return this.requests.get(id);
  }

  clear() {
    this.requests.clear();
    this.waiters.clear();
    this.counter = 0;
  }
}

export const queue = new PermissionQueue();
