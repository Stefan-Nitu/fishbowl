const SERVER_URL = process.env.SANDBOX_SERVER || "http://localhost:3700";

interface PermissionRequest {
  id: string;
  category: string;
  action: string;
  description: string;
  reason?: string;
  status: string;
  createdAt: number;
}

async function fetchQueue(): Promise<{ pending: PermissionRequest[]; recent: PermissionRequest[] }> {
  const res = await fetch(`${SERVER_URL}/api/queue`);
  return res.json();
}

async function approveRequest(id: string) {
  await fetch(`${SERVER_URL}/api/queue/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolvedBy: "cli" }),
  });
}

async function denyRequest(id: string) {
  await fetch(`${SERVER_URL}/api/queue/${id}/deny`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolvedBy: "cli" }),
  });
}

async function bulkAction(category: string, status: "approved" | "denied") {
  await fetch(`${SERVER_URL}/api/queue/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, status, resolvedBy: "cli" }),
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

const CATEGORY_COLORS: Record<string, string> = {
  network: "\x1b[34m",
  filesystem: "\x1b[35m",
  git: "\x1b[32m",
  packages: "\x1b[33m",
  sandbox: "\x1b[31m",
  exec: "\x1b[38;5;208m", // orange
};

function colorCat(cat: string): string {
  return `${CATEGORY_COLORS[cat] || ""}${cat}\x1b[0m`;
}

function printRequest(req: PermissionRequest) {
  console.log(
    `  ${req.id}  ${colorCat(req.category.padEnd(10))}  ${req.action}`
  );
  if (req.description !== req.action) {
    console.log(`          ${req.description}`);
  }
  if (req.reason) {
    console.log(`          reason: ${req.reason}`);
  }
  console.log(`          ${formatTime(req.createdAt)}`);
}

// --- Non-interactive mode ---
const args = process.argv.slice(2);

if (args.length > 0) {
  const [command, ...rest] = args;

  switch (command) {
    case "approve": {
      if (rest[0] === "--all") {
        const category = rest[1];
        if (category) {
          await bulkAction(category, "approved");
          console.log(`Approved all ${category} requests`);
        } else {
          console.log("Usage: cli approve --all <category>");
        }
      } else {
        for (const id of rest) {
          await approveRequest(id);
          console.log(`Approved ${id}`);
        }
      }
      break;
    }
    case "deny": {
      if (rest[0] === "--all") {
        const category = rest[1];
        if (category) {
          await bulkAction(category, "denied");
          console.log(`Denied all ${category} requests`);
        } else {
          console.log("Usage: cli deny --all <category>");
        }
      } else {
        for (const id of rest) {
          await denyRequest(id);
          console.log(`Denied ${id}`);
        }
      }
      break;
    }
    case "list":
    case "ls": {
      const { pending } = await fetchQueue();
      if (pending.length === 0) {
        console.log("No pending requests.");
      } else {
        console.log(`\n${pending.length} pending request(s):\n`);
        for (const req of pending) printRequest(req);
      }
      break;
    }
    default:
      console.log(`
fishbowl CLI

Usage:
  bun run cli list                   List pending requests
  bun run cli approve <id> [id...]   Approve request(s)
  bun run cli deny <id> [id...]      Deny request(s)
  bun run cli approve --all <cat>    Approve all in category
  bun run cli deny --all <cat>       Deny all in category
  bun run cli watch                  Interactive watch mode
`);
  }

  if (command !== "watch") process.exit(0);
}

// --- Interactive watch mode ---
console.log("\x1b[2J\x1b[H"); // Clear screen
console.log("fishbowl — Interactive Mode");
console.log("Commands: [a]pprove <id>, [d]eny <id>, [A] approve all, [D] deny all, [q]uit\n");

const ws = new WebSocket(`${SERVER_URL.replace("http", "ws")}/ws`);

ws.onmessage = (e: MessageEvent) => {
  const msg = JSON.parse(String(e.data));
  if (msg.type === "init") {
    const pending: PermissionRequest[] = msg.data.pending;
    if (pending.length > 0) {
      console.log(`\n${pending.length} pending:\n`);
      for (const req of pending) printRequest(req);
      console.log();
    }
  } else if (msg.type === "request") {
    console.log("\n\x1b[33m▶ New request:\x1b[0m");
    printRequest(msg.data);
    console.log();
  } else if (msg.type === "resolve") {
    const r = msg.data;
    const color = r.status === "approved" ? "\x1b[32m" : "\x1b[31m";
    console.log(`${color}✓ ${r.id} ${r.status}\x1b[0m`);
  }
};

ws.onopen = () => console.log("\x1b[32m● Connected\x1b[0m\n");
ws.onclose = () => {
  console.log("\x1b[31m● Disconnected\x1b[0m");
  process.exit(1);
};

// Read stdin for commands
process.stdin.setRawMode?.(false);
const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();

async function readLoop() {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const line = decoder.decode(value).trim();
    if (!line) continue;

    if (line === "q" || line === "quit") {
      ws.close();
      process.exit(0);
    }

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if ((cmd === "a" || cmd === "approve") && parts[1]) {
      await approveRequest(parts[1]);
    } else if ((cmd === "d" || cmd === "deny") && parts[1]) {
      await denyRequest(parts[1]);
    } else if (cmd === "A") {
      const cat = parts[1];
      if (cat) await bulkAction(cat, "approved");
      else console.log("Usage: A <category>");
    } else if (cmd === "D") {
      const cat = parts[1];
      if (cat) await bulkAction(cat, "denied");
      else console.log("Usage: D <category>");
    } else if (cmd === "l" || cmd === "ls" || cmd === "list") {
      const { pending } = await fetchQueue();
      if (pending.length === 0) console.log("No pending requests.");
      else for (const req of pending) printRequest(req);
    }
  }
}

readLoop();
