import { queue } from "./queue";
import { getRules } from "./config";
import { evaluateRules } from "./rules";

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecRequest {
  id: string;
  command: string;
  cwd?: string;
  reason?: string;
  timeout: number;
  status: "pending" | "approved" | "denied" | "running" | "completed" | "failed";
  result?: ExecResult;
  createdAt: number;
  completedAt?: number;
}

const execRequests = new Map<string, ExecRequest>();

export function getExecRequest(id: string): ExecRequest | undefined {
  return execRequests.get(id);
}

/**
 * Submit an exec request. Goes through the permission queue with mandatory
 * approve-each mode — no overrides. On approval, runs the command and stores
 * the result.
 */
export async function submitExec(
  command: string,
  cwd?: string,
  reason?: string,
  timeout?: number
): Promise<ExecRequest> {
  const timeoutMs = timeout ?? DEFAULT_TIMEOUT;

  const verdict = evaluateRules(getRules(), "exec", command);
  if (verdict === "deny") {
    const execReq: ExecRequest = {
      id: `exec-denied-${Date.now()}`,
      command, cwd, reason, timeout: timeoutMs,
      status: "denied", createdAt: Date.now(), completedAt: Date.now(),
    };
    execRequests.set(execReq.id, execReq);
    return execReq;
  }
  if (verdict === "allow") {
    const id = `exec-auto-${Date.now()}`;
    const execReq: ExecRequest = {
      id, command, cwd, reason, timeout: timeoutMs,
      status: "running", createdAt: Date.now(),
    };
    execRequests.set(id, execReq);
    try {
      execReq.result = await runCommand(command, cwd, timeoutMs);
      execReq.status = "completed";
    } catch (err) {
      execReq.result = { stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: -1 };
      execReq.status = "failed";
    }
    execReq.completedAt = Date.now();
    return execReq;
  }

  const { id, promise } = queue.request(
    "exec",
    command,
    `Execute on host: ${command}${cwd ? ` (in ${cwd})` : ""}`,
    reason,
    { command, cwd, timeout: timeoutMs }
  );

  const execReq: ExecRequest = {
    id,
    command,
    cwd,
    reason,
    timeout: timeoutMs,
    status: "pending",
    createdAt: Date.now(),
  };
  execRequests.set(id, execReq);

  // Wait for approval in the background, then execute
  promise.then(async (approved) => {
    if (!approved) {
      execReq.status = "denied";
      execReq.completedAt = Date.now();
      return;
    }

    execReq.status = "running";
    try {
      const result = await runCommand(command, cwd, timeoutMs);
      execReq.result = result;
      execReq.status = "completed";
    } catch (err) {
      execReq.result = {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: -1,
      };
      execReq.status = "failed";
    }
    execReq.completedAt = Date.now();
  });

  return execReq;
}

async function runCommand(
  command: string,
  cwd?: string,
  timeout?: number
): Promise<ExecResult> {
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd: cwd || undefined,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout ?? DEFAULT_TIMEOUT);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (timedOut) {
    return { stdout, stderr: stderr + "\n[timed out]", exitCode: 124 };
  }

  return { stdout, stderr, exitCode };
}
