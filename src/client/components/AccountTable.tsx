import { Button, Text } from "@cloudflare/kumo";
import {
  ArrowsClockwise,
  ClockCounterClockwise,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { AccountWithUsage } from "../types";
import UsageBar from "./UsageBar";

interface Props {
  accounts: AccountWithUsage[];
  refreshingIds: Set<string>;
  onRefresh: (id: string) => void;
  onEdit: (account: AccountWithUsage) => void;
  onDelete: (account: AccountWithUsage) => void;
  onHistory: (account: AccountWithUsage) => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  return `${min}分钟`;
}

export default function AccountTable({
  accounts,
  refreshingIds,
  onRefresh,
  onEdit,
  onDelete,
  onHistory,
}: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(id);
  }, []);
  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-kumo-line bg-kumo-elevated p-10 text-center">
        <Text variant="secondary" as="p" DANGEROUS_className="m-0">
          还没有账号。点击「添加账号」录入 Workspace ID 和 Auth Cookie。
        </Text>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {accounts.map((account) => {
        const refreshing = refreshingIds.has(account.id);
        const usage = account.usage;
        const hasError = Boolean(usage?.error);

        return (
          <article
            key={account.id}
            className="rounded-lg border border-kumo-line bg-kumo-elevated p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Text variant="heading4" as="h2" DANGEROUS_className="m-0">
                  {account.name}
                </Text>
                <Text
                  variant="secondary"
                  as="p"
                  DANGEROUS_className="m-0 mt-1 font-mono text-xs"
                >
                  <a
                    href={`https://opencode.ai/workspace/${encodeURIComponent(account.workspaceId)}/go`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {account.workspaceId}
                  </a>
                  {usage?.plan ? ` · ${usage.plan}` : ""}
                </Text>
                {account.notes ? (
                  <Text
                    variant="secondary"
                    as="p"
                    DANGEROUS_className="m-0 mt-1 text-sm"
                  >
                    {account.notes}
                  </Text>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={ArrowsClockwise}
                  onClick={() => onRefresh(account.id)}
                  disabled={refreshing}
                >
                  {refreshing ? "查询中" : "刷新"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={ClockCounterClockwise}
                  onClick={() => onHistory(account)}
                >
                  历史
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={PencilSimple}
                  onClick={() => onEdit(account)}
                >
                  编辑
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Trash}
                  onClick={() => onDelete(account)}
                >
                  删除
                </Button>
              </div>
            </div>

            <div className="mt-4">
              {hasError ? (
                <Text
                  variant="secondary"
                  as="p"
                  DANGEROUS_className="m-0 text-sm text-kumo-danger"
                >
                  {usage?.error}
                </Text>
              ) : usage ? (
                <div className="grid grid-cols-1 gap-x-12 gap-y-4 sm:grid-cols-3">
                  <UsageBar label="滚动用量" data={usage.rolling} />
                  <UsageBar label="每周用量" data={usage.weekly} />
                  <UsageBar label="每月用量" data={usage.monthly} />
                </div>
              ) : (
                <Text variant="secondary" as="p" DANGEROUS_className="m-0 text-sm">
                  尚未查询额度，点击「刷新」或「全部刷新」。
                </Text>
              )}

              {usage?.fetchedAt && !hasError ? (
                <Text
                  variant="secondary"
                  as="p"
                  DANGEROUS_className={`m-0 mt-3 text-[11px] ${Date.now() - new Date(usage.fetchedAt).getTime() > 3600000 ? "text-kumo-warning" : ""}`}
                >
                  距今 {relativeTime(new Date(usage.fetchedAt).getTime())},  更新于 {new Date(usage.fetchedAt).toLocaleString("zh-CN")}
                </Text>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}