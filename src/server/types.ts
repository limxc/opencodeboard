export interface AccountRow {
  id: string;
  name: string;
  workspace_id: string;
  auth_cookie: string;
  api_key: string;
  notes: string;
  last_usage: string;
  created_at: number;
  updated_at: number;
}

export interface AccountPublic {
  id: string;
  name: string;
  workspaceId: string;
  notes: string;
  hasCookie: boolean;
  hasApiKey: boolean;
  apiKey?: string;
  createdAt: number;
  updatedAt: number;
  usage?: UsageResult | null;
}

export interface AccountWithUsage extends AccountPublic {
  usage?: UsageResult;
}

export interface CreateAccountBody {
  name: string;
  workspaceId: string;
  authCookie: string;
  apiKey?: string;
  notes?: string;
}

export interface UpdateAccountBody {
  name?: string;
  workspaceId?: string;
  authCookie?: string;
  apiKey?: string;
  notes?: string;
}

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
