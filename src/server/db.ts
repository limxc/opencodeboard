import { getDb, closeDb, DATA_DIR } from './database';
import type { AccountRow, AccountPublic, AggregatedHistoryItem, CreateAccountBody, UpdateAccountBody, UsageHistoryItem, UsageHistoryResult, UsageResult } from './types';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

function toPublic(row: AccountRow): AccountPublic {
  let usage: UsageResult | null = null;
  if (row.last_usage) {
    try { usage = JSON.parse(row.last_usage) as UsageResult; } catch { /* ignore */ }
  }
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    notes: row.notes,
    hasCookie: !!row.auth_cookie,
    hasApiKey: !!row.api_key,
    apiKey: row.api_key || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usage,
  };
}

export function getAccountWorkspaceId(accountId: string): string | null {
  const row = getDb().prepare('SELECT workspace_id FROM accounts WHERE id = ?').get(accountId) as { workspace_id: string } | undefined;
  return row?.workspace_id ?? null;
}

export function saveAccountUsage(id: string, usage: UsageResult): void {
  const db = getDb();
  db.prepare('UPDATE accounts SET last_usage = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(usage), Date.now(), id);
}

export function listAccounts(): AccountPublic[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM accounts ORDER BY name COLLATE NOCASE').all() as AccountRow[];
  return rows.map(toPublic);
}

export function getAccountRow(id: string): AccountRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
}

export function createAccount(body: CreateAccountBody): AccountPublic {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, name, workspace_id, auth_cookie, api_key, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, body.name, body.workspaceId, body.authCookie, body.apiKey || '', body.notes || '', now, now);
  return toPublic({ id, name: body.name, workspace_id: body.workspaceId, auth_cookie: body.authCookie, api_key: body.apiKey || '', notes: body.notes || '', last_usage: '', created_at: now, updated_at: now });
}

export function updateAccount(id: string, body: UpdateAccountBody): AccountPublic | null {
  const db = getDb();
  const existing = getAccountRow(id);
  if (!existing) return null;
  const updates: string[] = [];
  const params: any[] = [];
  if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
  if (body.workspaceId !== undefined) { updates.push('workspace_id = ?'); params.push(body.workspaceId); }
  if (body.authCookie !== undefined) { updates.push('auth_cookie = ?'); params.push(body.authCookie); }
  if (body.apiKey !== undefined) { updates.push('api_key = ?'); params.push(body.apiKey); }
  if (body.notes !== undefined) { updates.push('notes = ?'); params.push(body.notes); }
  if (updates.length === 0) return toPublic(existing);
  updates.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);
  db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return toPublic(getAccountRow(id)!);
}

export function deleteAccount(id: string): boolean {
  const row = getDb().prepare('SELECT workspace_id FROM accounts WHERE id = ?').get(id) as { workspace_id: string } | undefined;
  if (!row) return false;

  const result = getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
  if (result.changes === 0) return false;

  const dbPath = path.join(DATA_DIR, `${row.workspace_id}.db`);
  try {
    if (fs.existsSync(dbPath)) {
      closeDb(row.workspace_id);
      fs.unlinkSync(dbPath);
    }
  } catch (err) {
    throw new Error(`删除数据库文件失败: ${err}`);
  }
  return true;
}

export function saveUsageHistoryItems(accountId: string, items: UsageHistoryItem[]): number {
  const wsId = getAccountWorkspaceId(accountId);
  if (!wsId) return 0;
  const db = getDb(wsId);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO usage_history
     (model, provider, input_tokens, output_tokens, reasoning_tokens,
      cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
      cost, key_id, session_id, plan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let count = 0;
  const insertMany = db.transaction(() => {
    for (const item of items) {
      const result = stmt.run(
        item.model, item.provider,
        item.inputTokens, item.outputTokens, item.reasoningTokens,
        item.cacheReadTokens, item.cacheWrite5mTokens, item.cacheWrite1hTokens,
        item.cost, item.keyID, item.sessionID, item.plan,
        new Date(item.createdAt).getTime()
      );
      if (result.changes > 0) count++;
    }
  });
  insertMany();
  return count;
}

export function getLatestHistoryCursor(accountId: string): number {
  const wsId = getAccountWorkspaceId(accountId);
  if (!wsId) return 0;
  const db = getDb(wsId);
  const row = db.prepare(
    `SELECT MAX(created_at) AS ts FROM usage_history`
  ).get() as { ts: number | null } | undefined;
  return row?.ts ?? 0;
}

export function getAggregatedHistory(accountId: string, cycleStart: number, cycleEnd?: number): AggregatedHistoryItem[] {
  const wsId = getAccountWorkspaceId(accountId);
  if (!wsId) return [];
  const db = getDb(wsId);
  const rows = db.prepare(
    `    SELECT date((created_at + 8*3600*1000) / 1000, 'unixepoch') AS date, model,
            SUM(cost) AS total_cost,
            SUM(input_tokens) AS total_input,
            SUM(output_tokens) AS total_output
     FROM usage_history
     WHERE created_at >= ?${cycleEnd ? ' AND created_at <= ?' : ''}
     GROUP BY date((created_at + 8*3600*1000) / 1000, 'unixepoch'), model
     ORDER BY date ASC`
  ).all(cycleEnd ? [cycleStart, cycleEnd] : [cycleStart]) as any[];
  return rows.map((r) => ({
    date: r.date,
    model: r.model,
    totalCost: r.total_cost,
    totalInput: r.total_input,
    totalOutput: r.total_output,
  }));
}

export function getUsageHistory(accountId: string, cursor: number, limit: number = 50): UsageHistoryResult {
  const wsId = getAccountWorkspaceId(accountId);
  if (!wsId) return { items: [], nextCursor: null };
  const db = getDb(wsId);
  const rows = db.prepare(
    `SELECT * FROM usage_history ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, cursor) as any[];
  const total = db.prepare(
    `SELECT COUNT(*) AS cnt FROM usage_history`
  ).get() as { cnt: number };
  const items: UsageHistoryItem[] = rows.map((r) => ({
    model: r.model,
    provider: r.provider,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    reasoningTokens: r.reasoning_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWrite5mTokens: r.cache_write_5m_tokens,
    cacheWrite1hTokens: r.cache_write_1h_tokens,
    cost: r.cost,
    keyID: r.key_id,
    sessionID: r.session_id,
    plan: r.plan,
    createdAt: r.created_at,
  }));
  const next = cursor + limit;
  return {
    items,
    nextCursor: next < total.cnt ? String(next) : null,
  };
}
