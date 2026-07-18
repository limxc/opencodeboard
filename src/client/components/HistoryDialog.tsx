import {
  Button,
  Dialog,
  Loader,
  Text,
} from "@cloudflare/kumo";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { fetchAggregatedHistory, refreshUsageHistory } from "../lib/api";
import type { AggregatedHistoryItem, AggregatedHistoryResult } from "../types";

const MONTH_MS = 31 * 86400 * 1000;

const chartStyles = `
.recharts-bar-background-rectangle { fill: transparent !important; }
.recharts-tooltip-cursor { fill: rgba(255,255,255,0.25) !important; }
`;

const CHART_BG = "#1e293b";
const CHART_TEXT = "#e2e8f0";
const CHART_GRID = "#334155";
const CHART_AXIS = "#475569";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountName: string;
  accountId: string;
  defaultCycleStart?: number;
}

const MODEL_COLORS = [
  "#60a5fa", "#f87171", "#4ade80", "#fbbf24", "#a78bfa",
  "#f472b6", "#2dd4bf", "#fb923c", "#818cf8", "#a3e635",
  "#22d3ee", "#e879f9", "#34d399", "#fb7185", "#38bdf8",
  "#c084fc", "#facc15", "#94a3b8", "#fdba74", "#5eead4",
];

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fmtLabel(date: string): string {
  const m = date.slice(5, 7);
  const d = date.slice(8, 10);
  return `${m}/${d}`;
}

interface ChartData {
  date: string;
  label: string;
  [model: string]: string | number;
}

function buildChartData(items: AggregatedHistoryItem[] | undefined, rangeStart?: number): { chartData: ChartData[]; models: string[] } {
  const modelSet = new Set<string>();
  const dateMap = new Map<string, Record<string, number>>();
  for (const item of items) {
    modelSet.add(item.model);
    if (!dateMap.has(item.date)) dateMap.set(item.date, {});
    const day = dateMap.get(item.date)!;
    const cost = item.totalCost / 100_000_000;
    day[item.model] = (day[item.model] || 0) + cost;
  }
  const models = Array.from(modelSet).sort();
  const data: ChartData[] = [];
  const start = rangeStart ? new Date(rangeStart) : new Date();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 31);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const entry: ChartData = { date: dateStr, label: fmtLabel(dateStr) };
    const dayCosts = dateMap.get(dateStr);
    for (const m of models) {
      entry[m] = dayCosts?.[m] ?? 0;
    }
    data.push(entry);
  }
  return { chartData: data, models };
}

function buildTokenChartData(items: AggregatedHistoryItem[] | undefined, rangeStart?: number): { chartData: ChartData[]; models: string[] } {
  const modelSet = new Set<string>();
  const dateMap = new Map<string, Record<string, number>>();
  for (const item of items ?? []) {
    modelSet.add(item.model);
    if (!dateMap.has(item.date)) dateMap.set(item.date, {});
    const day = dateMap.get(item.date)!;
    const tokens = item.totalInput + item.totalOutput;
    day[item.model] = (day[item.model] || 0) + tokens;
  }
  const models = Array.from(modelSet).sort();
  const data: ChartData[] = [];
  const start = rangeStart ? new Date(rangeStart) : new Date();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 31);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const entry: ChartData = { date: dateStr, label: fmtLabel(dateStr) };
    const dayCosts = dateMap.get(dateStr);
    for (const m of models) {
      entry[m] = dayCosts?.[m] ?? 0;
    }
    data.push(entry);
  }
  return { chartData: data, models };
}

const formatTokenAxis = (val: number) => {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  return String(val);
};

const fmtToken = (val: number) => {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
  return String(val);
};

const CostTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, e: any) => s + e.value, 0);
  return (
    <div style={{ backgroundColor: CHART_BG, border: `1px solid ${CHART_GRID}`, borderRadius: 8, padding: 10, minWidth: 140 }}>
      <p style={{ margin: "0 0 6px 0", fontWeight: 600, fontSize: 12, color: CHART_TEXT }}>{label}</p>
      {payload.map((entry: any) => entry.value > 0 ? (
        <p key={entry.name} style={{ margin: "2px 0", fontSize: 12, color: entry.color }}>
          {entry.name}: {fmtTooltip(entry.value)}
        </p>
      ) : null)}
      <p style={{ margin: "6px 0 0 0", paddingTop: 6, borderTop: `1px solid ${CHART_GRID}`, fontWeight: 600, fontSize: 12, color: CHART_TEXT }}>
        合计: {fmtTooltip(total)}
      </p>
    </div>
  );
};

const TokenTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, e: any) => s + e.value, 0);
  return (
    <div style={{ backgroundColor: CHART_BG, border: `1px solid ${CHART_GRID}`, borderRadius: 8, padding: 10, minWidth: 140 }}>
      <p style={{ margin: "0 0 6px 0", fontWeight: 600, fontSize: 12, color: CHART_TEXT }}>{label}</p>
      {payload.map((entry: any) => entry.value > 0 ? (
        <p key={entry.name} style={{ margin: "2px 0", fontSize: 12, color: entry.color }}>
          {entry.name}: {fmtToken(entry.value)}
        </p>
      ) : null)}
      <p style={{ margin: "6px 0 0 0", paddingTop: 6, borderTop: `1px solid ${CHART_GRID}`, fontWeight: 600, fontSize: 12, color: CHART_TEXT }}>
        合计: {fmtToken(total)}
      </p>
    </div>
  );
};

const formatYAxis = (val: number) => {
  if (val === 0) return '$0';
  if (val >= 1) return `$${Number.isInteger(val) ? val.toFixed(0) : val.toFixed(2)}`;
  if (val >= 0.01) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(5)}`;
};

const fmtTooltip = (val: number) => `$${Number.isInteger(val) ? val.toFixed(0) : val.toFixed(2)}`;

function niceTicks(max: number): number[] {
  const raw = max / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const residual = raw / magnitude;
  let nice: number;
  if (residual <= 1.5) nice = 1 * magnitude;
  else if (residual <= 3.5) nice = 2 * magnitude;
  else if (residual <= 7.5) nice = 5 * magnitude;
  else nice = 10 * magnitude;
  const ticks: number[] = [];
  for (let i = 0; i <= 5; i++) {
    ticks.push(+(nice * i).toFixed(10));
  }
  return ticks;
}

export default function HistoryDialog({
  open,
  onOpenChange,
  accountName,
  accountId,
  defaultCycleStart,
}: Props) {
  const [data, setData] = useState<AggregatedHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState("");
  const [error, setError] = useState("");
  const [cycleStart, setCycleStart] = useState(0);
  const [hasPrevData, setHasPrevData] = useState(false);
  const [hasNextData, setHasNextData] = useState(false);

  const loadData = useCallback(async (cs: number) => {
    setLoading(true);
    setError("");
    setCycleStart(cs);
    try {
      const [res, prev, next] = await Promise.all([
        fetchAggregatedHistory(accountId, cs, cs + MONTH_MS),
        fetchAggregatedHistory(accountId, cs - MONTH_MS, cs).catch(() => ({ items: [] })),
        fetchAggregatedHistory(accountId, cs + MONTH_MS, cs + 2 * MONTH_MS).catch(() => ({ items: [] })),
      ]);
      setHasPrevData((prev as any).items?.length > 0);
      setHasNextData((next as any).items?.length > 0);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载历史失败");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError("");
      return;
    }
    const cs = defaultCycleStart ?? 0;
    setCycleStart(cs);
    setLoading(true);
    loadData(cs).finally(() => setLoading(false));
  }, [open, accountId, loadData, defaultCycleStart]);

  const { chartData, models } = useMemo(
    () => data ? buildChartData(data.items, data.cycleStart) : { chartData: [], models: [] },
    [data]
  );

  const yMax = useMemo(() => {
    if (chartData.length === 0) return 1;
    const max = Math.max(
      ...chartData.map((d) => models.reduce((sum, m) => sum + (d[m] as number), 0))
    );
    return max > 0 ? max / 0.8 : 1;
  }, [chartData, models]);

  const tokenData = useMemo(
    () => data ? buildTokenChartData(data.items, data.cycleStart) : { chartData: [], models: [] },
    [data]
  );

  const tokenYMax = useMemo(() => {
    if (tokenData.chartData.length === 0) return 1;
    const max = Math.max(
      ...tokenData.chartData.map((d) => tokenData.models.reduce((sum, m) => sum + (d[m] as number), 0))
    );
    return max > 0 ? max / 0.8 : 1;
  }, [tokenData]);

  const tokenYTicks = useMemo(() => {
    const ticks = niceTicks(tokenYMax);
    const last = ticks[ticks.length - 1];
    if (last < tokenYMax) {
      ticks.push(+(last + (ticks[1] - ticks[0])).toFixed(10));
    }
    return ticks;
  }, [tokenYMax]);
  const tokenYDomainMax = tokenYTicks[tokenYTicks.length - 1];

  const yTicks = useMemo(() => {
    const ticks = niceTicks(yMax);
    const last = ticks[ticks.length - 1];
    if (last < yMax) {
      ticks.push(+(last + (ticks[1] - ticks[0])).toFixed(10));
    }
    return ticks;
  }, [yMax]);
  const yDomainMax = yTicks[yTicks.length - 1];

  const cycleLabel = data && data.cycleStart > 0
    ? `${fmtDate(data.cycleStart)}-${fmtDate(data.cycleEnd)}`
    : "";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <style>{chartStyles}</style>
      <Dialog className="!w-[80vw] !max-w-[80vw] !h-[80vh] !max-h-[80vh] !flex !flex-col p-6">
        <div className="grid grid-cols-3 items-center gap-4">
          <Dialog.Title>{accountName}</Dialog.Title>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full hover:bg-kumo-line/30 disabled:opacity-30 disabled:pointer-events-none"
              disabled={loading || !hasPrevData}
              onClick={() => loadData(cycleStart - MONTH_MS)}
            >
              <CaretLeft size={14} />
            </button>
            {cycleLabel && (
              <p className="text-xs text-kumo-subtle tabular-nums">
                {cycleLabel}
              </p>
            )}
            <button
              type="button"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full hover:bg-kumo-line/30 disabled:opacity-30 disabled:pointer-events-none"
              disabled={loading || !hasNextData}
              onClick={() => loadData(cycleStart + MONTH_MS)}
            >
              <CaretRight size={14} />
            </button>
          </div>
          <div className="flex justify-end gap-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                setRefreshing(true);
                setRefreshProgress("");
                try {
                  const result = await refreshUsageHistory(accountId, (page, count) => {
                    setRefreshProgress(`已拉取 ${String(page).padStart(3, "0")}页`);
                  });
                  setCycleStart(result.cycleStart);
                  await loadData(result.cycleStart);
                } catch (err) {
                  setError(err instanceof Error ? err.message : '刷新失败');
                } finally {
                  setRefreshing(false);
                  setRefreshProgress("");
                }
              }}
              disabled={refreshing}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              {refreshing ? '同步中' : '同步'}
            </Button>
          </div>
        </div>

        <div className={`relative mt-4 flex-1 min-h-0 ${refreshing ? 'overflow-hidden' : 'overflow-auto'}`}>
          {refreshing && (
            <div className="absolute inset-0 flex items-center justify-center z-20" style={{ transform: "scale(2)", backgroundColor: "var(--kumo-bg, #0f172a)" }}>
              <div className="flex flex-col items-center gap-3">
                <Loader />
                <span className="whitespace-nowrap">{refreshProgress || '同步中…'}</span>
              </div>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-10 text-kumo-subtle">
              <Loader />
              加载历史…
            </div>
          ) : error ? (
            <Text
              variant="secondary"
              as="p"
              DANGEROUS_className="m-0 text-sm text-kumo-danger"
            >
              {error}
            </Text>
          ) : chartData.length > 0 ? (
            <div className="flex flex-col gap-4" style={{ height: "100%" }}>
              <div className="flex-1 min-h-0" style={{ backgroundColor: CHART_BG, border: `1px solid ${CHART_GRID}`, borderRadius: 8, padding: 16, position: "relative" }}>
                <span style={{ position: "absolute", top: 4, right: 12, fontSize: 11, color: CHART_TEXT, fontWeight: 500, zIndex: 5 }}>
                  费用 ({data ? (data.items.reduce((s, i) => s + i.totalCost / 100_000_000, 0)).toFixed(2) : '0'} / 60$)
                </span>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_TEXT }} stroke={CHART_AXIS} axisLine={{ stroke: CHART_AXIS }} />
                    <YAxis domain={[0, yDomainMax]} ticks={yTicks} tickFormatter={formatYAxis} tick={{ fontSize: 12, fill: CHART_TEXT }} stroke={CHART_AXIS} axisLine={{ stroke: CHART_AXIS }} />
                    <Tooltip content={<CostTooltip />} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} />
                    <Legend wrapperStyle={{ fontSize: 11, color: CHART_TEXT }} />
                    {models.map((model, i) => (
                      <Bar
                        key={model}
                        dataKey={model}
                        stackId="cost"
                        fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 min-h-0" style={{ backgroundColor: CHART_BG, border: `1px solid ${CHART_GRID}`, borderRadius: 8, padding: 16, position: "relative" }}>
                <span style={{ position: "absolute", top: 4, right: 12, fontSize: 11, color: CHART_TEXT, fontWeight: 500, zIndex: 5 }}>
                  Token用量 ( Input + Output )
                </span>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tokenData.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_TEXT }} stroke={CHART_AXIS} axisLine={{ stroke: CHART_AXIS }} />
                    <YAxis domain={[0, tokenYDomainMax]} ticks={tokenYTicks} tickFormatter={formatTokenAxis} tick={{ fontSize: 12, fill: CHART_TEXT }} stroke={CHART_AXIS} axisLine={{ stroke: CHART_AXIS }} />
                    <Tooltip content={<TokenTooltip />} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} />
                    <Legend wrapperStyle={{ fontSize: 11, color: CHART_TEXT }} />
                    {tokenData.models.map((model, i) => (
                      <Bar
                        key={model}
                        dataKey={model}
                        stackId="tokens"
                        fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <Text variant="secondary" as="p" DANGEROUS_className="m-0 text-sm">
              暂无历史记录。
            </Text>
          )}
        </div>


      </Dialog>
    </Dialog.Root>
  );
}
