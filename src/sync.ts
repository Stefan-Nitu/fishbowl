import { queue } from "./queue";
import { getCategoryMode } from "./config";
import type { SyncFile } from "./types";

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

  if (mode === "allow-all") {
    for (const f of files) {
      await syncFile(f.path);
      results.set(f.path, true);
    }
    return results;
  }

  // Request approval for each file
  const pending: { file: SyncFile; id: string; promise: Promise<boolean> }[] = [];
  for (const f of files) {
    const { id, promise } = queue.request(
      "filesystem",
      `sync ${f.path}`,
      `Sync file from container to host: ${f.path} (${formatBytes(f.size)})`,
      "Agent modified this file in the sandbox"
    );
    pending.push({ file: f, id, promise });
  }

  // Wait for all approvals (they resolve independently)
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
