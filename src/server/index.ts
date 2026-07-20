import express from 'express';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { getDb, closeDb } from './database';
import {
  isAuthenticated,
  createSessionToken,
  sessionCookie,
  clearSessionCookie,
} from './auth';
import {
  listAccounts,
  getAccountRow,
  createAccount,
  updateAccount,
  deleteAccount,
  reorderAccounts,
  saveAccountUsage,
  saveUsageHistoryItems,
  getUsageHistory,
  getAggregatedHistory,
  getLatestHistoryCursor,
} from './db';
import {
  fetchGoQuota,
  fetchGoUsageHistory,
  validateAuthCookie,
  validateWorkspaceId,
} from './quota';
import type {
  AccountWithUsage,
  AggregatedHistoryItem,
  CreateAccountBody,
  UpdateAccountBody,
  UsageHistoryItem,
} from './types';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const PASSWD = process.env.PASSWD || '';

if (!PASSWD) {
  console.error('服务未配置 PASSWD');
  process.exit(1);
}

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), 'dist/client')));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: '未授权，请先登录' });
  }
  next();
}

app.post('/api/auth/login', (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    if (!password || password !== PASSWD) {
      return res.status(401).json({ error: '密码错误' });
    }
    const token = createSessionToken();
    res.setHeader('Set-Cookie', sessionCookie(token));
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: '请求格式错误' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const authed = isAuthenticated(req);
  res.json({ authenticated: authed });
});

app.get('/api/accounts', (req, res) => {
  const accounts = listAccounts();
  res.json({ accounts });
});

app.post('/api/accounts', requireAuth, (req, res) => {
  try {
    const body = req.body as CreateAccountBody;
    const nameError = !body.name?.trim() ? '名称不能为空' : null;
    const wsError = validateWorkspaceId(body.workspaceId ?? '');
    const cookieError = validateAuthCookie(body.authCookie ?? '');
    const error = nameError ?? wsError ?? cookieError;
    if (error) return res.status(400).json({ error });

    const account = createAccount(body);

    // Initialize per-account database
    const usageDb = getDb(body.workspaceId);
    runMigrations(path.resolve(process.cwd(), 'migrations/usage_history'), usageDb, `usage_history:${body.workspaceId}`);

    return res.status(201).json({ account });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : '创建失败' });
  }
});

app.put('/api/accounts/:id', requireAuth, (req, res) => {
  try {
    const body = req.body as UpdateAccountBody;
    if (body.workspaceId) {
      const wsError = validateWorkspaceId(body.workspaceId);
      if (wsError) return res.status(400).json({ error: wsError });
    }
    if (body.authCookie) {
      const cookieError = validateAuthCookie(body.authCookie);
      if (cookieError) return res.status(400).json({ error: cookieError });
    }
    if (body.name !== undefined && !body.name.trim()) {
      return res.status(400).json({ error: '名称不能为空' });
    }

    const id = req.params.id as string;
    const account = updateAccount(id, body);
    if (!account) return res.status(404).json({ error: '账号不存在' });
    return res.json({ account });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : '更新失败' });
  }
});

app.delete('/api/accounts/:id', requireAuth, (req, res) => {
  const id = req.params.id as string;
  const ok = deleteAccount(id);
  if (!ok) return res.status(404).json({ error: '账号不存在' });
  res.json({ ok: true });
});

app.put('/api/accounts/reorder', requireAuth, (req, res) => {
  try {
    const { orders } = req.body as { orders: { id: string; sort_order: number }[] };
    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'orders 必须是数组' });
    }
    reorderAccounts(orders);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : '排序失败' });
  }
});

app.post('/api/accounts/:id/refresh', requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const row = getAccountRow(id);
  if (!row) return res.status(404).json({ error: '账号不存在' });

  try {
    const usage = await fetchGoQuota(row.workspace_id, row.auth_cookie);
    saveAccountUsage(id, usage);
    return res.json({ id, usage });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : '查询失败';
    const hasHistory = getLatestHistoryCursor(id) > 0;
    const usage = {
      rolling: null,
      weekly: null,
      monthly: null,
      plan: '',
      fetchedAt: new Date().toISOString(),
      error: hasHistory ? errMsg : '新账号暂无数据',
    };
    return res.json({ id, usage });
  }
});

app.post('/api/accounts/:id/history/refresh', requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const row = getAccountRow(id);
  if (!row) return res.status(404).json({ error: '账号不存在' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (data: any) => { res.write(`data: ${JSON.stringify(data)}\n\n`); };

  try {
    const now = Date.now();
    let cycleEnd = now;
    if (row.last_usage) {
      try {
        const usage = JSON.parse(row.last_usage) as {
          monthly?: { resetInSec?: number };
          weekly?: { resetInSec?: number };
          rolling?: { resetInSec?: number };
          fetchedAt?: string;
        };
        const resetInSec = usage.monthly?.resetInSec;
        const base = usage.fetchedAt ? new Date(usage.fetchedAt).getTime() : now;
        if (resetInSec) {
          cycleEnd = base + resetInSec * 1000;
        }
      } catch { /* ignore parse errors */ }
    }
    const cycleStart = cycleEnd - 31 * 86400 * 1000;

    let cursor: number | null = 0;
    let totalSaved = 0;
    let seq = 0;

    while (cursor !== null) {
      const history = await fetchGoUsageHistory(row.workspace_id, row.auth_cookie, cursor);
      if (history.items.length === 0) {
        console.log(`cursor=${cursor} → 0 条，停止`);
        break;
      }

      const saved = saveUsageHistoryItems(id, history.items);
      totalSaved += saved;
      seq++;
      send({ page: seq, count: history.items.length });
      const pad = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const ts = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      console.log(`${ts} | ${String(seq).padStart(3, "0")} | 拉取${history.items.length}条 cursor=${cursor} nextCursor=${history.nextCursor} saved=${saved}`);

      if (saved === 0) {
        console.log(`saved=0，停止`);
        break;
      }

      const oldest = history.items[history.items.length - 1].createdAt;
      if (oldest < cycleStart) {
        console.log(`最旧记录 ${oldest} < cycleStart ${cycleStart}，已超出周期范围，停止`);
        break;
      }

      cursor = history.nextCursor ? Number(history.nextCursor) : null;
    }

    send({ done: true, saved: totalSaved, cycleStart, cycleEnd });
    res.end();
  } catch (err) {
    send({ error: err instanceof Error ? err.message : '刷新历史失败' });
    res.end();
  }
});

app.get('/api/accounts/:id/history', requireAuth, (req, res) => {
  const cursorParam = Number(req.query.cursor ?? '0');
  const cursor = Number.isFinite(cursorParam) && cursorParam >= 0 ? cursorParam : 0;
  const id = req.params.id as string;

  const row = getAccountRow(id);
  if (!row) return res.status(404).json({ error: '账号不存在' });

  const history = getUsageHistory(id, cursor, 50);
  return res.json({ id, history });
});

app.get('/api/accounts/:id/history/aggregated', requireAuth, (req, res) => {
  const id = req.params.id as string;
  const cycleStart = Number(req.query.cycleStart ?? '0');
  const cycleEnd = req.query.cycleEnd ? Number(req.query.cycleEnd) : undefined;

  const row = getAccountRow(id);
  if (!row) return res.status(404).json({ error: '账号不存在' });
  if (cycleStart === undefined || cycleStart === null || isNaN(cycleStart)) return res.status(400).json({ error: '缺少 cycleStart 参数' });

  const items = getAggregatedHistory(id, cycleStart, cycleEnd);
  const end = cycleEnd ?? cycleStart + 31 * 86400 * 1000;
  return res.json({
    id,
    cycleStart,
    cycleEnd: end,
    items,
  });
});

app.post('/api/refresh', requireAuth, async (req, res) => {
  let ids: string[] | null = null;
  try {
    const body = req.body as { ids?: string[] };
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      ids = body.ids;
    }
  } catch {
    // refresh all when body empty or invalid
  }

  const accounts = listAccounts();
  const targetIds = new Set(ids ?? accounts.map((a) => a.id));

  const results: AccountWithUsage[] = await Promise.all(
    accounts
      .filter((a) => targetIds.has(a.id))
      .map(async (account) => {
        const row = getAccountRow(account.id);
        if (!row) {
          return { ...account, usage: undefined };
        }
        try {
          const usage = await fetchGoQuota(row.workspace_id, row.auth_cookie);
          saveAccountUsage(account.id, usage);
          return { ...account, usage };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : '查询失败';
          const hasHistory = getLatestHistoryCursor(account.id) > 0;
          const usage = {
            rolling: null,
            weekly: null,
            monthly: null,
            plan: '',
            fetchedAt: new Date().toISOString(),
            error: hasHistory ? errMsg : '新账号暂无数据',
          };
          return { ...account, usage };
        }
      })
  );

  res.json({ accounts: results });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.resolve(process.cwd(), 'dist/client/index.html'));
});

function runMigrations(dir: string, db: Database.Database, label: string): void {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).sort()) {
    if (file.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
      try {
        db.exec(sql);
        console.log(`[${label}] Applied migration: ${file}`);
      } catch (err: any) {
        console.log(`[${label}] Migration ${file}: ${err.message}`);
      }
    }
  }
}

// Run accounts migrations
runMigrations(path.resolve(process.cwd(), 'migrations/accounts'), getDb(), 'accounts');

// Migrate from old single-file database
const OLD_DB_PATH = path.resolve(process.cwd(), 'data/test.db');
if (fs.existsSync(OLD_DB_PATH)) {
  try {
    const oldDb = new Database(OLD_DB_PATH);
    const rows = oldDb.prepare('SELECT * FROM accounts').all() as any[];
    if (rows.length > 0) {
      const insert = getDb().prepare(
        `INSERT OR IGNORE INTO accounts (id, name, workspace_id, auth_cookie, notes, last_usage, created_at, updated_at)
         VALUES (@id, @name, @workspace_id, @auth_cookie, @notes, @last_usage, @created_at, @updated_at)`
      );
      const migrate = getDb().transaction(() => {
        for (const row of rows) insert.run(row);
      });
      migrate();
      console.log(`Migrated ${rows.length} accounts from ${OLD_DB_PATH}`);
    }
    oldDb.close();
  } catch (err: any) {
    console.log(`Migration from ${OLD_DB_PATH}: ${err.message}`);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
