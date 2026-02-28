import { queue } from "./queue";
import { getCategoryMode, getRules } from "./config";
import { evaluateRules } from "./rules";
import type { PermissionRequest, SyncFile } from "./types";

const WORKSPACE = process.env.WORKSPACE || "/workspace/merged";
const HOST_PROJECT = process.env.HOST_PROJECT || "/workspace/lower";

export async function listChangedFiles(): Promise<SyncFile[]> {
  const files: SyncFile[] = [];
  try {
    // Use git to detect changes in the workspace
    const result = await Bun.$`git -C ${WORKSPACE} diff --name-only HEAD`.text();
    const untrackedResult = await Bun.$`git -C ${WORKSPACE} ls-files --others --exclude-standard`.text();

    const paths = [
      ...result.trim().split("\n"),
      ...untrackedResult.trim().split("\n"),
    ].filter(Boolean);

    for (const path of paths) {
      const file = Bun.file(`${WORKSPACE}/${path}`);
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
  const src = `${WORKSPACE}/${relPath}`;
  const dst = `${HOST_PROJECT}/${relPath}`;

  // Ensure destination directory exists
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
  const targetPath = `${WORKSPACE}/${targetFile}`;

  if (toolName === "Write") {
    const content = meta.writeContent as string | undefined;
    if (content === undefined) return { ok: false, error: "No writeContent in metadata" };

    // Ensure directory exists
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
