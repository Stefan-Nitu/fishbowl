import { queue } from "./queue";
import { getCategoryMode } from "./config";
import type { SyncFile } from "./types";

const OVERLAY_UPPER = process.env.OVERLAY_UPPER || "/workspace/upper";
const HOST_PROJECT = process.env.HOST_PROJECT || "/workspace/host";

export async function listChangedFiles(): Promise<SyncFile[]> {
  const files: SyncFile[] = [];
  try {
    await scanDir(OVERLAY_UPPER, "", files);
  } catch {
    // Overlay dir may not exist outside Docker
  }
  return files;
}

async function scanDir(base: string, rel: string, out: SyncFile[]) {
  const glob = new Bun.Glob("**/*");
  for await (const path of glob.scan({ cwd: base, onlyFiles: true })) {
    const file = Bun.file(`${base}/${path}`);
    out.push({
      path,
      size: file.size,
      modifiedAt: (await file.stat?.())?.mtimeMs ?? Date.now(),
    });
  }
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
  const src = `${OVERLAY_UPPER}/${relPath}`;
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
