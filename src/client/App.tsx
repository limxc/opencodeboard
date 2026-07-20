import { Button, Loader, Text } from "@cloudflare/kumo";
import { ArrowsClockwise, Plus, SignOut } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MONTH_MS = 31 * 86400 * 1000;
import AccountDialog from "./components/AccountDialog";
import Toast from "./components/Toast";
import AccountTable from "./components/AccountTable";
import HistoryDialog from "./components/HistoryDialog";
import LoginForm from "./components/LoginForm";
import {
  checkAuth,
  createAccount,
  deleteAccount,
  fetchAccounts,
  logout,
  reorderAccounts,
  refreshAll,
  refreshOne,
  updateAccount,
} from "./lib/api";
import { computeSummary } from "./lib/format";
import type { Account, AccountFormData, AccountWithUsage } from "./types";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<AccountWithUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [historyAccount, setHistoryAccount] = useState<AccountWithUsage | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await fetchAccounts();
      setAccounts(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const ok = await checkAuth();
        setAuthed(ok);
        if (ok) await loadAccounts();
      } catch {
        setAuthed(false);
      }
    })();
  }, [loadAccounts]);

  useEffect(() => {
    if (autoTimer.current) {
      clearInterval(autoTimer.current);
      autoTimer.current = null;
    }
    if (autoRefresh > 0) {
      autoTimer.current = setInterval(() => {
        handleRefreshAll();
      }, autoRefresh * 1000);
    }
    return () => {
      if (autoTimer.current) clearInterval(autoTimer.current);
    };
  }, [autoRefresh]);

  const summary = useMemo(() => computeSummary(accounts.filter((a) => a.usage && !a.usage.error)), [accounts]);

  async function handleLogout() {
    await logout();
    setAuthed(false);
    setAccounts([]);
  }

  async function handleRefreshAll() {
    setRefreshingAll(true);
    setError("");
    try {
      const results = await refreshAll();
      const map = new Map(results.map((a) => [a.id, a]));
      setAccounts((prev) =>
        prev.map((a) => map.get(a.id) ?? a)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRefreshingAll(false);
    }
  }

  async function handleRefreshOne(id: string) {
    setRefreshingIds((prev) => new Set(prev).add(id));
    try {
      const usage = await refreshOne(id);
      setAccounts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, usage } : a))
      );
    } catch (err) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                usage: {
                  rolling: null,
                  weekly: null,
                  monthly: null,
                  plan: null,
                  fetchedAt: new Date().toISOString(),
                  error: err instanceof Error ? err.message : "查询失败",
                },
              }
            : a
        )
      );
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleSave(form: AccountFormData) {
    if (editingAccount) {
      const payload: Partial<AccountFormData> = {
        name: form.name,
        workspaceId: form.workspaceId,
        notes: form.notes,
      };
      if (form.authCookie.trim()) {
        payload.authCookie = form.authCookie;
      }
      if (form.apiKey.trim()) {
        payload.apiKey = form.apiKey;
      }
      const updated = await updateAccount(editingAccount.id, payload);
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === updated.id ? { ...updated, usage: a.usage } : a
        )
      );
    } else {
      const created = await createAccount(form);
      setAccounts((prev) => [{ ...created, usage: null }, ...prev]);
    }
  }

  async function handleDelete(account: AccountWithUsage) {
    if (!confirm(`确定删除账号「${account.name}」？`)) return;
    await deleteAccount(account.id);
    setAccounts((prev) => prev.filter((a) => a.id !== account.id));
  }

  async function handleReorder(reordered: AccountWithUsage[]) {
    const orders = reordered.map((a, i) => ({ id: a.id, sort_order: i }));
    setAccounts(reordered);
    try {
      await reorderAccounts(orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存排序失败');
      setAccounts(await fetchAccounts());
    }
  }

  if (authed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-3 text-kumo-subtle">
        <Loader />
        加载中…
      </div>
    );
  }

  if (!authed) {
    return (
      <LoginForm
        onSuccess={async () => {
          setAuthed(true);
          await loadAccounts();
        }}
      />
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Text variant="heading2" as="h1" DANGEROUS_className="m-0">
            OpenCode Go 多账号看板
          </Text>
          <div className="mt-2 text-xs text-kumo-subtle">
            <div>共 {summary.total} 个账号</div>
            {(summary.weeklyWarn > 0 || summary.weeklyDanger > 0 || summary.monthlyWarn > 0 || summary.monthlyDanger > 0) ? (
              <div className="mt-1">
                {(summary.weeklyWarn > 0 || summary.weeklyDanger > 0) ? (
                  <div>
                    每周用量:
                    {summary.weeklyWarn > 0 ? <span className="text-kumo-warning"> {summary.weeklyWarn}个余量不足</span> : null}
                    {summary.weeklyDanger > 0 ? <span className="text-kumo-danger"> {summary.weeklyDanger}个即将耗尽</span> : null}
                  </div>
                ) : null}
                {(summary.monthlyWarn > 0 || summary.monthlyDanger > 0) ? (
                  <div>
                    每月用量:
                    {summary.monthlyWarn > 0 ? <span className="text-kumo-warning"> {summary.monthlyWarn}个余量不足</span> : null}
                    {summary.monthlyDanger > 0 ? <span className="text-kumo-danger"> {summary.monthlyDanger}个即将耗尽</span> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative w-40" onBlur={() => setTimeout(() => setMenuOpen(false), 200)}>
            <button
              type="button"
              className="inline-flex w-full h-9 cursor-pointer items-center rounded-lg pl-9 pr-3 text-sm font-medium text-white shadow-sm disabled:opacity-50 bg-kumo-info"
              disabled={refreshingAll || accounts.length === 0}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <ArrowsClockwise size={16} className="absolute left-3 top-1/2 -translate-y-1/2" />
              <span>{autoRefresh > 0 ? `自动刷新(${autoRefresh / 60}分钟)` : '刷新策略'}</span>
            </button>
            {menuOpen ? (
              <div
                className="absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black/5"
                onMouseDown={(e) => e.preventDefault()}
              >
                {[
                  { label: '手动刷新', value: 0 },
                  { label: '自动刷新(1分钟)', value: 60 },
                  { label: '自动刷新(5分钟)', value: 300 },
                  { label: '自动刷新(10分钟)', value: 600 },
                  { label: '自动刷新(30分钟)', value: 1800 },
                  { label: '自动刷新(60分钟)', value: 3600 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`block w-full px-4 py-2 text-left text-sm hover:bg-blue-50 ${autoRefresh === opt.value ? 'font-semibold text-blue-600' : 'text-gray-700'}`}
                    onClick={() => {
                      if (opt.value === 0) handleRefreshAll();
                      setAutoRefresh(opt.value);
                      setMenuOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Button
            variant="secondary"
            icon={Plus}
            onClick={() => {
              setEditingAccount(null);
              setDialogOpen(true);
            }}
          >
            添加账号
          </Button>
          <Button variant="secondary" icon={SignOut} onClick={handleLogout}>
            退出
          </Button>
        </div>
      </header>

      {error ? (
        <Text
          variant="secondary"
          as="p"
          DANGEROUS_className="mb-4 text-kumo-danger"
        >
          {error}
        </Text>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-kumo-subtle">
          <Loader />
          加载账号…
        </div>
      ) : (
        <AccountTable
          accounts={accounts}
          refreshingIds={refreshingIds}
          onRefresh={handleRefreshOne}
          onEdit={(account) => {
            setEditingAccount(account);
            setDialogOpen(true);
          }}
          onDelete={handleDelete}
          onHistory={(account) => setHistoryAccount(account)}
          onReorder={handleReorder}
        />
      )}

      <AccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editingAccount}
        onSave={handleSave}
      />

      <Toast />

      <HistoryDialog
        open={historyAccount !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryAccount(null);
        }}
        accountId={historyAccount?.id ?? ""}
        accountName={historyAccount?.name ?? ""}
        defaultCycleStart={(() => {
          const a = historyAccount;
          if (!a?.usage) return Date.now() - MONTH_MS;
          const { monthly, fetchedAt } = a.usage;
          const resetInSec = monthly?.resetInSec;
          const base = fetchedAt ? new Date(fetchedAt).getTime() : Date.now();
          const cycleEnd = resetInSec ? base + resetInSec * 1000 : Date.now();
          return cycleEnd - MONTH_MS;
        })()}
      />

      <Text
        variant="secondary"
        as="p"
        DANGEROUS_className="m-0 mt-8 text-center text-xs"
      >
        Workspace ID获取路径: 登录OpenCode → https://opencode.ai/workspace/<span className="text-kumo-success">wrk_ ... 0CH</span>
      </Text>
      <Text
        variant="secondary"
        as="p"
        DANGEROUS_className="m-0 text-center text-xs mt-1"
      >
        Cookie获取路径: 开发者工具 → 应用程序 → Cookie → https://opencode.ai → auth → <span className="text-kumo-success">值</span>
      </Text>
    </div>
  );
}