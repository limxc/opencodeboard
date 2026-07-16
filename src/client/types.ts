export interface UsageWindow {
  usagePercent: number;
  resetInSec: number;
}

export interface UsageResult {
  rolling: UsageWindow | null;
  weekly: UsageWindow | null;
  monthly: UsageWindow | null;
  plan: string | null;
  fetchedAt: string;
  error?: string;
}

export interface Account {
  id: string;
  name: string;
  workspaceId: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  hasCookie: boolean;
}

export interface AccountWithUsage extends Account {
  usage: UsageResult | null;
}

export interface UsageHistoryItem {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cost: number;
  keyID: string;
  sessionID: string;
  plan: string;
  createdAt: number;
}

export interface UsageHistoryResult {
  items: UsageHistoryItem[];
  nextCursor: string | null;
}

export interface AggregatedHistoryItem {
  date: string;
  model: string;
  totalCost: number;
  totalInput: number;
  totalOutput: number;
}

export interface AggregatedHistoryResult {
  id: string;
  cycleStart: number;
  cycleEnd: number;
  items: AggregatedHistoryItem[];
}

export interface AccountFormData {
  name: string;
  workspaceId: string;
  authCookie: string;
  notes: string;
}