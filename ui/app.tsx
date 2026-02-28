import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

interface PermissionRequest {
  id: string;
  category: string;
  action: string;
  description: string;
  reason?: string;
  status: "pending" | "approved" | "denied";
  metadata?: Record<string, unknown>;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SandboxConfig {
  allowedEndpoints: string[];
  categories: Record<string, { mode: string }>;
  gitStagingRepo: string;
}

interface RuleSet {
  allow: string[];
  deny: string[];
}

type Tab = "queue" | "config" | "rules" | "history";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function FilesystemDiff({ metadata }: { metadata: Record<string, unknown> }) {
  const toolName = metadata.toolName as string;
  const targetFile = metadata.targetFile as string;

  return (
    <div className="fs-diff">
      <div className="fs-target">{targetFile}</div>
      {toolName === "Edit" && metadata.editContext && (() => {
        const ctx = metadata.editContext as { old_string: string; new_string: string };
        return (
          <div className="diff-blocks">
            <pre className="diff-old">{ctx.old_string}</pre>
            <pre className="diff-new">{ctx.new_string}</pre>
          </div>
        );
      })()}
      {toolName === "Write" && metadata.writeContent && (
        <pre className="diff-new">
          {String(metadata.writeContent).length > 500
            ? String(metadata.writeContent).slice(0, 500) + "\n..."
            : String(metadata.writeContent)}
        </pre>
      )}
    </div>
  );
}

function ExecOutput({ result }: { result: ExecResult }) {
  return (
    <div className="exec-output">
      {result.stdout && (
        <pre className="exec-stdout">{result.stdout}</pre>
      )}
      {result.stderr && (
        <pre className="exec-stderr">{result.stderr}</pre>
      )}
      <span className={`exec-exit ${result.exitCode === 0 ? "success" : "failure"}`}>
        exit {result.exitCode}
      </span>
    </div>
  );
}

function App() {
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [recent, setRecent] = useState<PermissionRequest[]>([]);
  const [config, setConfig] = useState<SandboxConfig | null>(null);
  const [rules, setRules] = useState<RuleSet>({ allow: [], deny: [] });
  const [tab, setTab] = useState<Tab>("queue");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connectWs = useCallback(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connectWs, 2000);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setPending(msg.data.pending);
        setConfig(msg.data.config);
        if (msg.data.rules) setRules(msg.data.rules);
      } else if (msg.type === "rules") {
        setRules(msg.data);
      } else if (msg.type === "request") {
        setPending((prev) => [...prev, msg.data]);
      } else if (msg.type === "resolve") {
        const resolved = msg.data as PermissionRequest;
        setPending((prev) => prev.filter((r) => r.id !== resolved.id));
        setRecent((prev) => [resolved, ...prev].slice(0, 50));
      }
    };
  }, []);

  useEffect(() => {
    // Initial fetch
    fetch("/api/queue")
      .then((r) => r.json())
      .then(({ pending: p, recent: r }) => {
        setPending(p);
        setRecent(r.filter((x: PermissionRequest) => x.status !== "pending"));
      });
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig);
    fetch("/api/rules")
      .then((r) => r.json())
      .then(setRules);

    connectWs();
    return () => wsRef.current?.close();
  }, [connectWs]);

  async function approve(id: string) {
    await fetch(`/api/queue/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  async function deny(id: string) {
    await fetch(`/api/queue/${id}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  async function alwaysAllow(id: string) {
    await fetch(`/api/queue/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alwaysAllow: true }),
    });
  }

  async function alwaysDeny(id: string) {
    await fetch(`/api/queue/${id}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alwaysDeny: true }),
    });
  }

  async function deleteRule(type: "allow" | "deny", rule: string) {
    const res = await fetch("/api/rules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, rule }),
    });
    const data = await res.json();
    if (data.rules) setRules(data.rules);
  }

  async function bulkAction(category: string, status: "approved" | "denied") {
    await fetch("/api/queue/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, status }),
    });
  }

  const categories = [...new Set(pending.map((r) => r.category))];

  return (
    <div className="app">
      <header>
        <h1>fishbowl</h1>
        <span className={`status ${connected ? "connected" : ""}`}>
          {connected ? "live" : "disconnected"}
        </span>
        {pending.length > 0 && (
          <span className="status">{pending.length} pending</span>
        )}
      </header>

      <div className="tabs">
        <button className={tab === "queue" ? "active" : ""} onClick={() => setTab("queue")}>
          Queue {pending.length > 0 && `(${pending.length})`}
        </button>
        <button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>
          Rules ({rules.allow.length + rules.deny.length})
        </button>
        <button className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}>
          Config
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {tab === "queue" && (
        <div>
          {categories.length > 0 && (
            <div className="bulk-actions">
              {categories.map((cat) => (
                <React.Fragment key={cat}>
                  <button
                    className="btn btn-approve btn-bulk"
                    onClick={() => bulkAction(cat, "approved")}
                  >
                    Approve all {cat}
                  </button>
                  <button
                    className="btn btn-deny btn-bulk"
                    onClick={() => bulkAction(cat, "denied")}
                  >
                    Deny all {cat}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          <div className="request-list">
            {pending.length === 0 && (
              <div className="empty">No pending requests. The agent is running freely.</div>
            )}
            {pending.map((req) => (
              <div key={req.id} className="request-card">
                <div className="top-row">
                  <span className={`category-badge ${req.category}`}>{req.category}</span>
                  <span className="action">{req.action}</span>
                </div>
                {req.category === "exec" && req.metadata?.command && (
                  <pre className="exec-command">{String(req.metadata.command)}</pre>
                )}
                {req.category === "filesystem" && req.metadata?.toolName && (
                  <FilesystemDiff metadata={req.metadata} />
                )}
                <div className="description">{req.description}</div>
                {req.reason && <div className="description">Reason: {req.reason}</div>}
                <div className="time">{req.id} — {timeAgo(req.createdAt)}</div>
                <div className="buttons">
                  <button className="btn btn-approve" onClick={() => approve(req.id)}>
                    Approve
                  </button>
                  <button className="btn btn-always" onClick={() => alwaysAllow(req.id)}>
                    Always Allow
                  </button>
                  <button className="btn btn-deny" onClick={() => deny(req.id)}>
                    Deny
                  </button>
                  <button className="btn btn-always-deny" onClick={() => alwaysDeny(req.id)}>
                    Always Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "rules" && (
        <div>
          <div className="config-section" style={{ marginBottom: 16 }}>
            <h3>Allow Rules</h3>
            {rules.allow.length === 0 && (
              <div className="config-item"><span className="config-key">No allow rules</span></div>
            )}
            {rules.allow.map((rule) => (
              <div key={rule} className="config-item">
                <span className="config-value">{rule}</span>
                <button className="btn btn-deny btn-bulk" onClick={() => deleteRule("allow", rule)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="config-section">
            <h3>Deny Rules</h3>
            {rules.deny.length === 0 && (
              <div className="config-item"><span className="config-key">No deny rules</span></div>
            )}
            {rules.deny.map((rule) => (
              <div key={rule} className="config-item">
                <span className="config-value">{rule}</span>
                <button className="btn btn-deny btn-bulk" onClick={() => deleteRule("deny", rule)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "config" && config && (
        <div>
          <div className="config-section" style={{ marginBottom: 16 }}>
            <h3>Allowed Endpoints</h3>
            {config.allowedEndpoints.map((ep) => (
              <div key={ep} className="config-item">
                <span className="config-value">{ep}</span>
              </div>
            ))}
            {config.allowedEndpoints.length === 0 && (
              <div className="config-item">
                <span className="config-key">None — all network requests require approval</span>
              </div>
            )}
          </div>

          <div className="config-section" style={{ marginBottom: 16 }}>
            <h3>Category Modes</h3>
            {Object.entries(config.categories).map(([cat, cfg]) => (
              <div key={cat} className="config-item">
                <span className="config-key">{cat}</span>
                <span className="config-value">{cfg.mode}</span>
              </div>
            ))}
          </div>

          <div className="config-section">
            <h3>Git Staging</h3>
            <div className="config-item">
              <span className="config-key">repo</span>
              <span className="config-value">{config.gitStagingRepo}</span>
            </div>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="request-list">
          {recent.length === 0 && (
            <div className="empty">No history yet.</div>
          )}
          {recent
            .filter((r) => r.status !== "pending")
            .map((req) => (
              <div key={req.id} className={`request-card history-item ${req.status}`}>
                <div className="top-row">
                  <span className={`category-badge ${req.category}`}>{req.category}</span>
                  <span className="action">{req.action}</span>
                  <span className={`status-badge ${req.status}`}>{req.status}</span>
                </div>
                <div className="description">{req.description}</div>
                {req.category === "filesystem" && req.metadata?.toolName && (
                  <FilesystemDiff metadata={req.metadata} />
                )}
                {req.category === "exec" && req.metadata?.execResult && (
                  <ExecOutput result={req.metadata.execResult as ExecResult} />
                )}
                <div className="time">
                  {req.id} — {timeAgo(req.createdAt)}
                  {req.resolvedAt && ` — resolved ${timeAgo(req.resolvedAt)}`}
                  {req.resolvedBy && ` via ${req.resolvedBy}`}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
