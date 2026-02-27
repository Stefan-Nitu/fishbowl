import { queue } from "./queue";
import { getConfig, getCategoryMode } from "./config";
import type { GitSyncInfo } from "./types";

export async function listUnsyncedBranches(): Promise<GitSyncInfo[]> {
  const config = getConfig();
  const stagingRepo = config.gitStagingRepo;
  const results: GitSyncInfo[] = [];

  try {
    // List branches in staging repo
    const { stdout } = await Bun.$`git -C ${stagingRepo} branch --format='%(refname:short)'`.quiet();
    const branches = stdout.toString().trim().split("\n").filter(Boolean);

    for (const branch of branches) {
      // Count commits that aren't in the real remote
      // We compare against the tracking branch if it exists
      try {
        const { stdout: logOut } =
          await Bun.$`git -C ${stagingRepo} log --oneline ${branch} --not --remotes=real-remote 2>/dev/null || echo ""`.quiet();
        const lines = logOut.toString().trim().split("\n").filter(Boolean);

        if (lines.length > 0 && lines[0] !== "") {
          const { stdout: diffStat } =
            await Bun.$`git -C ${stagingRepo} diff --stat real-remote/${branch}...${branch} 2>/dev/null || echo "new branch"`.quiet();

          results.push({
            branch,
            commits: lines.length,
            summary: diffStat.toString().trim() || `${lines.length} new commit(s)`,
          });
        }
      } catch {
        // Branch may not have a remote counterpart yet
        results.push({
          branch,
          commits: 0,
          summary: "New branch (no remote counterpart)",
        });
      }
    }
  } catch {
    // Staging repo may not exist outside Docker
  }

  return results;
}

export async function requestGitSync(branch: string): Promise<boolean> {
  const mode = getCategoryMode("git");

  if (mode === "deny-all") return false;
  if (mode === "allow-all") {
    await performGitSync(branch);
    return true;
  }

  const info = (await listUnsyncedBranches()).find((i) => i.branch === branch);
  const { promise } = queue.request(
    "git",
    `push ${branch}`,
    `Sync branch "${branch}" from staging to real remote${info ? `: ${info.summary}` : ""}`,
    "Agent wants to push changes to the real remote"
  );

  const approved = await promise;
  if (approved) await performGitSync(branch);
  return approved;
}

async function performGitSync(branch: string) {
  const config = getConfig();
  const stagingRepo = config.gitStagingRepo;

  // Push from staging repo to real remote
  await Bun.$`git -C ${stagingRepo} push real-remote ${branch}`.quiet();
}
