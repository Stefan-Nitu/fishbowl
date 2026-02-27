export type Category = "network" | "filesystem" | "git" | "packages" | "sandbox";

export type ApprovalMode = "approve-each" | "approve-bulk" | "allow-all" | "deny-all";

export type RequestStatus = "pending" | "approved" | "denied";

export interface PermissionRequest {
  id: string;
  category: Category;
  action: string;
  description: string;
  reason?: string;
  status: RequestStatus;
  metadata?: Record<string, unknown>;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: "cli" | "web" | "auto";
}

export interface CategoryConfig {
  mode: ApprovalMode;
}

export interface SandboxConfig {
  allowedEndpoints: string[];
  gitStagingRepo: string;
  categories: Record<Category, CategoryConfig>;
}

export interface ConfigChangeProposal {
  path: string;
  value: unknown;
  reason: string;
}

export interface QueueEvents {
  request: (req: PermissionRequest) => void;
  resolve: (req: PermissionRequest) => void;
}

export interface SyncFile {
  path: string;
  size: number;
  modifiedAt: number;
}

export interface GitSyncInfo {
  branch: string;
  commits: number;
  summary: string;
}

export const DEFAULT_CONFIG: SandboxConfig = {
  allowedEndpoints: ["api.anthropic.com"],
  gitStagingRepo: "/data/git-staging.git",
  categories: {
    network: { mode: "approve-each" },
    filesystem: { mode: "approve-each" },
    git: { mode: "approve-each" },
    packages: { mode: "approve-each" },
    sandbox: { mode: "approve-each" },
  },
};
