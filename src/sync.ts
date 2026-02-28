import { queue } from "./queue";
import { getCategoryMode, getRules } from "./config";
import { evaluateRules } from "./rules";
import type { PermissionRequest, SyncFile } from "./types";

const getWorkspace = () => process.env.WORKSPACE || "/workspace/merged";
const getHostProject = () => process.env.HOST_PROJECT || "/workspace/lower";
const SYNC_INTERVAL_MS = 2000;
let syncTimer: ReturnType<typeof setInterval> | null = null;

export async function listChangedFiles(): Promise<SyncFile[]> {
  const ws = getWorkspace();
  const files: SyncFile[] = [];
  try {
    const result = await Bun.$`git -C ${ws} diff --name-only HEAD`.text();
    const untrackedResult = await Bun.$`git -C ${ws} ls-files --others --exclude-standard`.text();

    const paths = [
      ...result.trim().split("\n"),
      ...untrackedResult.trim().split("\n"),
    ].filter(Boolean);

    for (const path of paths) {
      const file = Bun.file(`${ws}/${path}`);
      const stat = await file.stat?.();
      files.push({
        path,
        size: file.size,
        modifiedAt: stat?.mtimeMs ?? Date.now(),
      });
    }
  } catch {
    // Git dir may not exist outside Docker
  }
  return files;
}

export async function requestFileSync(files: SyncFile[]): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const mode = getCategoryMode("filesystem");

  if (mode === "deny-all") {
    for (const f of files) results.set(f.path, false);
    return results;
  }

  const needsQueue: SyncFile[] = [];
  const rules = getRules();

  for (const f of files) {
    const verdict = evaluateRules(rules, "filesystem", f.path);
    if (verdict === "deny") {
      results.set(f.path, false);
      continue;
    }
    if (verdict === "allow") {
      await syncFile(f.path);
      results.set(f.path, true);
      continue;
    }
    if (mode === "allow-all") {
      await syncFile(f.path);
      results.set(f.path, true);
    } else {
      needsQueue.push(f);
    }
  }

  const pending: { file: SyncFile; id: string; promise: Promise<boolean> }[] = [];
  for (const f of needsQueue) {
    const { id, promise } = queue.request(
      "filesystem",
      `sync ${f.path}`,
      `Sync file from container to host: ${f.path} (${formatBytes(f.size)})`,
      "Agent modified this file in the sandbox"
    );
    pending.push({ file: f, id, promise });
  }

  await Promise.all(
    pending.map(async ({ file, promise }) => {
      const approved = await promise;
      if (approved) await syncFile(file.path);
      results.set(file.path, approved);
    })
  );

  return results;
}

async function syncFile(relPath: string) {
  const src = `${getWorkspace()}/${relPath}`;
  const dst = `${getHostProject()}/${relPath}`;

  const dir = dst.substring(0, dst.lastIndexOf("/"));
  await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.$`cp ${src} ${dst}`.quiet();
}

export async function applyFilesystemRequest(
  req: PermissionRequest
): Promise<{ ok: boolean; error?: string }> {
  const meta = req.metadata;
  if (!meta?.toolName || !meta?.targetFile) {
    return { ok: false, error: "Missing toolName or targetFile in metadata" };
  }

  const toolName = meta.toolName as string;
  const targetFile = meta.targetFile as string;
  const targetPath = `${getWorkspace()}/${targetFile}`;

  if (toolName === "Write") {
    const content = meta.writeContent as string | undefined;
    if (content === undefined) return { ok: false, error: "No writeContent in metadata" };

    const dir = targetPath.substring(0, targetPath.lastIndexOf("/"));
    await Bun.$`mkdir -p ${dir}`.quiet();
    await Bun.write(targetPath, content);
    return { ok: true };
  }

  if (toolName === "Edit") {
    const editContext = meta.editContext as { old_string: string; new_string: string } | undefined;
    if (!editContext) return { ok: false, error: "No editContext in metadata" };

    let currentContent: string;
    try {
      currentContent = await Bun.file(targetPath).text();
    } catch {
      return { ok: false, error: "Target file does not exist — edit is stale" };
    }

    if (!currentContent.includes(editContext.old_string)) {
      return { ok: false, error: "old_string not found in file — edit is stale" };
    }

    const updated = currentContent.replace(editContext.old_string, editContext.new_string);
    await Bun.write(targetPath, updated);
    return { ok: true };
  }

  return { ok: false, error: `Unknown toolName: ${toolName}` };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function fullSync(): Promise<number> {
  const ws = getWorkspace();
  const hp = getHostProject();
  try {
    await Bun.$`rsync -a --delete --exclude .git --exclude node_modules ${ws}/ ${hp}/`.quiet();
  } catch {
    return 0;
  }
  return 1;
}

export function startLiveSync(): void {
  const ws = getWorkspace();
  const hp = getHostProject();

  const checkInterval = setInterval(async () => {
    try {
      await Bun.file(`${ws}/.git/HEAD`).text();
      clearInterval(checkInterval);
      beginPolling();
    } catch {
      // Workspace not ready yet
    }
  }, SYNC_INTERVAL_MS);

  function beginPolling() {
    console.log(`[sync] Live mirror started: ${ws} → ${hp} (polling)`);
    fullSync();

    // fs.watch doesn't work across Docker containers — use polling rsync
    syncTimer = setInterval(async () => {
      try {
        await Bun.$`rsync -a --delete --exclude .git --exclude node_modules ${ws}/ ${hp}/`.quiet();
      } catch {}
    }, SYNC_INTERVAL_MS);
  }
}

export function stopLiveSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
