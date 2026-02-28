import { appendFile, readFile, mkdir } from "fs/promises";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const AUDIT_FILE = DATA_DIR + "audit.log";

export interface AuditEntry {
  timestamp: number;
  id: string;
  category: string;
  action: string;
  decision: "approved" | "denied";
  resolvedBy?: "cli" | "web" | "auto";
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort — don't block the main flow
  }
}

export async function readAuditLog(limit = 100): Promise<AuditEntry[]> {
  try {
    const content = await readFile(AUDIT_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: AuditEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
    // Most recent first
    entries.reverse();
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}
