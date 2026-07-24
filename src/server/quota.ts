import { randomUUID } from 'crypto';
import type {
  UsageHistoryItem,
  UsageHistoryResult,
  UsageResult,
  UsageWindow,
} from "./types";

const WORKSPACE_RE = /^wrk_[a-zA-Z0-9]+$/;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0';
const TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 4 << 20;
const DEFAULT_USAGE_SERVER_ID = 'bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c';

const RE_ROLLING_PCT_FIRST = /rollingUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
const RE_ROLLING_RESET_FIRST = /rollingUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
const RE_WEEKLY_PCT_FIRST = /weeklyUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
const RE_WEEKLY_RESET_FIRST = /weeklyUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
const RE_MONTHLY_PCT_FIRST = /monthlyUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
const RE_MONTHLY_RESET_FIRST = /monthlyUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
const RE_PLAN = /plan:\$R\[\d+\]="([^"]+)"/;

const RE_USAGE_RECORD = /id:"(usg_[^"]+)"[^}]*?timeCreated:\$R\[\d+\]=new Date\("([^"]+)"\)[^}]*?model:"([^"]+)"[^}]*?provider:"([^"]+)"[^}]*?inputTokens:(\d+)[^}]*?outputTokens:(\d+)[^}]*?cost:(-?\d+)[^}]*?keyID:"([^"]+)"/gs;
const RE_PLAN_ENRICH = /id:"(usg_[^"]+)"[^}]*?enrichment:\$R\[\d+\]=\{plan:"([^"]+)"\}/gs;

function buildCookieHeader(authCookie: string): string {
  let cookie = authCookie.trim();
  if (cookie.toLowerCase().startsWith('cookie:')) cookie = cookie.slice(7).trim();
  if (!cookie) return '';
  for (const part of cookie.split(';')) {
    const p = part.trim();
    if (p.startsWith('auth=')) return p;
  }
  return `auth=${cookie}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseWindow(
  pctFirst: RegExp,
  resetFirst: RegExp,
  html: string,
): [number, number] | null {
  let match = pctFirst.exec(html);
  if (match) return [parseFloat(match[1]), Math.trunc(parseFloat(match[2]))];
  match = resetFirst.exec(html);
  if (match) return [parseFloat(match[2]), Math.trunc(parseFloat(match[1]))];
  return null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function validateWorkspaceId(workspaceId: string): string | null {
  if (!workspaceId?.trim()) return "Workspace ID 不能为空";
  if (!WORKSPACE_RE.test(workspaceId.trim())) {
    return "Workspace ID 格式无效（应为 wrk_xxx）";
  }
  return null;
}

export function validateAuthCookie(authCookie: string): string | null {
  if (!authCookie?.trim()) return "Auth Cookie 不能为空";
  if (!authCookie.trim().startsWith("Fe26.")) {
    return "Auth Cookie 格式无效（应以 Fe26. 开头）";
  }
  return null;
}

export async function fetchGoQuota(
  workspaceId: string,
  authCookie: string
): Promise<UsageResult> {
  const wsError = validateWorkspaceId(workspaceId);
  if (wsError) throw new Error(wsError);
  const cookieError = validateAuthCookie(authCookie);
  if (cookieError) throw new Error(cookieError);

  const cookieHeader = buildCookieHeader(authCookie);
  const url = `https://opencode.ai/workspace/${encodeURIComponent(workspaceId)}/go`;

  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: cookieHeader,
    },
    redirect: "manual",
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("认证失败，Cookie 可能已过期");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Dashboard 重定向，请检查 workspace_id 与 cookie");
  }
  if (!response.ok) {
    throw new Error(`请求失败 (HTTP ${response.status})`);
  }

  const finalUrl = response.url;
  if (finalUrl.includes("/sign-in") || finalUrl.includes("/login")) {
    throw new Error("会话已过期，请重新登录并更新 Cookie");
  }

  const html = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
  if (html.includes("/sign-in") && !html.includes("rollingUsage")) {
    throw new Error("会话已过期，请重新登录并更新 Cookie");
  }

  const usage: UsageResult = {
    rolling: null,
    weekly: null,
    monthly: null,
    plan: null,
    fetchedAt: new Date().toISOString(),
  };

  const windows: { key: 'rolling' | 'weekly' | 'monthly'; pct: RegExp; reset: RegExp }[] = [
    { key: 'rolling', pct: RE_ROLLING_PCT_FIRST, reset: RE_ROLLING_RESET_FIRST },
    { key: 'weekly', pct: RE_WEEKLY_PCT_FIRST, reset: RE_WEEKLY_RESET_FIRST },
    { key: 'monthly', pct: RE_MONTHLY_PCT_FIRST, reset: RE_MONTHLY_RESET_FIRST },
  ];

  let foundAny = false;
  for (const { key, pct, reset } of windows) {
    const parsed = parseWindow(pct, reset, html);
    if (parsed) {
      usage[key] = {
        usagePercent: clampPercent(parsed[0]),
        resetInSec: parsed[1],
      };
      foundAny = true;
    }
  }

  const planMatch = html.match(RE_PLAN);
  usage.plan = planMatch ? planMatch[1] : "";

  if (!foundAny) {
    throw new Error("解析页面额度数据失败");
  }

  return usage;
}

function parseUsageRecords(body: string): UsageHistoryItem[] {
  const plans = new Map<string, string>();
  let pm: RegExpExecArray | null;
  while ((pm = RE_PLAN_ENRICH.exec(body)) !== null) {
    plans.set(pm[1], pm[2]);
  }

  const items: UsageHistoryItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE_USAGE_RECORD.exec(body)) !== null) {
    const usgId = m[1];
    const timeCreated = m[2];
    items.push({
      model: m[3],
      provider: m[4],
      inputTokens: parseInt(m[5], 10),
      outputTokens: parseInt(m[6], 10),
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cost: parseInt(m[7], 10),
      keyID: m[8],
      sessionID: "",
      plan: plans.get(usgId) ?? "",
      createdAt: timeCreated ? new Date(timeCreated).getTime() : Date.now(),
    });
  }
  return items;
}

export async function fetchGoUsageHistory(
  workspaceId: string,
  authCookie: string,
  cursor: number = 0
): Promise<UsageHistoryResult> {
  const wsError = validateWorkspaceId(workspaceId);
  if (wsError) throw new Error(wsError);
  const cookieError = validateAuthCookie(authCookie);
  if (cookieError) throw new Error(cookieError);

  const cookieHeader = buildCookieHeader(authCookie);
  const wsId = workspaceId.trim();
  const page = cursor;

  const args: unknown[] = [wsId];
  if (page > 0) args.push(page);

  const url = `https://opencode.ai/_server?id=${encodeURIComponent(DEFAULT_USAGE_SERVER_ID)}&args=${encodeURIComponent(JSON.stringify(args))}`;
  const referer = `https://opencode.ai/workspace/${encodeURIComponent(wsId)}/usage`;

  const response = await fetchWithTimeout(url, {
    headers: {
      Cookie: cookieHeader,
      'X-Server-Id': DEFAULT_USAGE_SERVER_ID,
      'X-Server-Instance': `server-fn:${randomUUID()}`,
      'User-Agent': USER_AGENT,
      Origin: 'https://opencode.ai',
      Referer: referer,
      Accept: 'text/javascript, application/json;q=0.9, */*;q=0.8',
    },
    redirect: 'manual',
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("认证失败，Cookie 可能已过期");
  }
  if (!response.ok) {
    throw new Error(`使用记录查询返回 HTTP ${response.status}`);
  }

  const body = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
  if (body.includes("/sign-in") && !body.includes("usg_")) {
    throw new Error("会话已过期，请重新登录并更新 Cookie");
  }

  const items = parseUsageRecords(body);

  if (items.length === 0) {
    return { items: [], nextCursor: null };
  }

  items.sort((a, b) => b.createdAt - a.createdAt);

  const nextCursor = items.length >= 50 ? String(cursor + 1) : null;

  return { items, nextCursor };
}
