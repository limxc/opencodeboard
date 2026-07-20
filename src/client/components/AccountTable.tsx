import { Button, Text } from "@cloudflare/kumo";
import {
  ArrowsClockwise,
  ClockCounterClockwise,
  ClipboardText,
  DotsSixVertical,
  Eye,
  EyeSlash,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { AccountWithUsage } from "../types";
import UsageBar from "./UsageBar";
import { toast } from "./Toast";

interface Props {
  accounts: AccountWithUsage[];
  refreshingIds: Set<string>;
  onRefresh: (id: string) => void;
  onEdit: (account: AccountWithUsage) => void;
  onDelete: (account: AccountWithUsage) => void;
  onHistory: (account: AccountWithUsage) => void;
  onReorder: (accounts: AccountWithUsage[]) => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 300_000) return "刚刚";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `距今${min}分钟`;
  const hours = Math.floor(min / 60);
  const mins = min % 60;
  if (hours < 24) return `距今${hours}小时${mins > 0 ? mins + '分钟' : ''}`;
  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  return `距今${days}天${hrs > 0 ? hrs + '小时' : ''}`;
}

export default function AccountTable({
  accounts,
  refreshingIds,
  onRefresh,
  onEdit,
  onDelete,
  onHistory,
  onReorder,
}: Props) {
  const [, setTick] = useState(0);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const handleDragEnd = useCallback((result: any) => {
    if (!result.destination) return;
    const reordered = [...accounts];
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    flushSync(() => {
      onReorder(reordered);
    });
  }, [accounts, onReorder]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
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
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="accounts">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps} className="flex flex-col gap-4">
      {accounts.map((account, index) => {
        const refreshing = refreshingIds.has(account.id);
        const usage = account.usage;
        const hasError = Boolean(usage?.error);

        return (
          <Draggable key={account.id} draggableId={account.id} index={index}>
            {(dragProvided, snapshot) => (
          <div
            ref={dragProvided.innerRef}
            {...dragProvided.draggableProps}
            className={`flex items-start gap-2 rounded-lg border bg-kumo-elevated p-4 shadow-sm ${snapshot.isDragging ? 'shadow-lg ring-2 ring-blue-400' : 'border-kumo-line'}`}
            style={dragProvided.draggableProps.style}
          >
            <button
              type="button"
              className="mt-1 cursor-grab active:cursor-grabbing text-kumo-subtle hover:text-kumo-text touch-none shrink-0"
              {...dragProvided.dragHandleProps}
            >
              <DotsSixVertical size={18} />
            </button>
            <article className="flex-1 min-w-0">
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
                    href={`https://opencode.ai/workspace/${encodeURIComponent(account.workspaceId)}/usage`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-kumo-link hover:underline"
                  >
                    {account.workspaceId}
                  </a>
                  {usage?.plan ? ` · ${usage.plan}` : ""}
                </Text>
                  {account.hasApiKey && account.apiKey ? (
                    <span className="mt-1 flex items-center gap-1 font-mono text-xs text-kumo-subtle">
                      <span className="truncate">
                        {visibleKeys.has(account.id) ? account.apiKey : "••••••••••••"}
                      </span>
                      <button
                        type="button"
                        className="cursor-pointer hover:text-kumo-text"
                        onClick={() =>
                          setVisibleKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(account.id)) next.delete(account.id);
                            else next.add(account.id);
                            return next;
                          })
                        }
                        title={visibleKeys.has(account.id) ? "隐藏" : "显示"}
                      >
                        {visibleKeys.has(account.id) ? (
                          <EyeSlash size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="cursor-pointer hover:text-kumo-text"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(account.apiKey!);
                            toast("Copied API Key");
                          } catch {
                            toast("Copy failed");
                          }
                        }}
                        title="复制"
                      >
                        <ClipboardText size={14} />
                      </button>
                    </span>
                  ) : null}
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
                  DANGEROUS_className={`m-0 text-sm ${usage?.error === '新账号暂无数据' ? 'text-kumo-warning' : 'text-kumo-danger'}`}
                >
                  {usage?.error === '新账号暂无数据' ? '新账号暂无数据，可消耗 token 后刷新重试' : usage?.error}
                </Text>
              ) : usage ? (
                <div className="grid grid-cols-1 gap-x-12 gap-y-4 sm:grid-cols-3">
                  <UsageBar label="滚动用量" data={usage.rolling} />
                  <UsageBar label="每周用量" data={usage.weekly} />
                  <UsageBar label="每月用量" data={usage.monthly} />
                </div>
              ) : (
                <Text variant="secondary" as="p" DANGEROUS_className="m-0 text-sm">
                  点击「刷新」查询额度
                </Text>
              )}

              {usage?.fetchedAt && !hasError ? (
                <Text
                  variant="secondary"
                  as="p"
                  DANGEROUS_className={`m-0 mt-3 text-[11px] ${Date.now() - new Date(usage.fetchedAt).getTime() > 3600000 ? "text-kumo-warning" : ""}`}
                >
                  {relativeTime(new Date(usage.fetchedAt).getTime())},  更新于 {new Date(usage.fetchedAt).toLocaleString("zh-CN")}
                </Text>
              ) : null}
            </div>
          </article>
          </div>
            )}
          </Draggable>
        );
      })}
      </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}