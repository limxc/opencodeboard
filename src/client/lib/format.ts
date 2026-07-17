export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins} 分钟`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
}

export function usageStatus(percent: number): "ok" | "warn" | "danger" {
  if (percent > 90) return "danger";
  if (percent >= 75) return "warn";
  return "ok";
}

export function usageBarColor(percent: number): string {
  const status = usageStatus(percent);
  if (status === "danger") return "bg-kumo-danger";
  if (status === "warn") return "bg-kumo-warning";
  return "bg-kumo-success";
}

export function usageTextColor(percent: number): string {
  const status = usageStatus(percent);
  if (status === "danger") return "text-kumo-danger";
  if (status === "warn") return "text-kumo-warning";
  return "text-kumo-success";
}

export interface AccountUsage {
  usage: {
    weekly?: { usagePercent: number } | null;
    monthly?: { usagePercent: number } | null;
  } | null;
}

export interface Summary {
  total: number;
  weeklyWarn: number;
  weeklyDanger: number;
  monthlyWarn: number;
  monthlyDanger: number;
}

function countByStatus(accounts: AccountUsage[], key: "weekly" | "monthly"): { warn: number; danger: number } {
  let warn = 0;
  let danger = 0;
  for (const a of accounts) {
    const percent = a.usage?.[key]?.usagePercent ?? 0;
    const status = usageStatus(percent);
    if (status === "warn") warn++;
    else if (status === "danger") danger++;
  }
  return { warn, danger };
}

export function computeSummary(accounts: AccountUsage[]): Summary {
  const total = accounts.length;
  const weekly = countByStatus(accounts, "weekly");
  const monthly = countByStatus(accounts, "monthly");
  return { total, weeklyWarn: weekly.warn, weeklyDanger: weekly.danger, monthlyWarn: monthly.warn, monthlyDanger: monthly.danger };
}

