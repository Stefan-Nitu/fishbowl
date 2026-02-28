const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare number → treat as milliseconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // Match sequences like "1h", "30m", "1h30m", "2h15m30s"
  const pattern = /(\d+)(ms|[smhd])/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(trimmed)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multiplier = UNITS[unit];
    if (!multiplier) return null;
    total += value * multiplier;
    matched = true;
  }

  return matched ? total : null;
}

export function formatDuration(ms: number): string {
  if (ms < 0) return "0s";

  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}
