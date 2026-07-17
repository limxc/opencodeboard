import { describe, it, expect } from "vitest";
import { usageStatus, computeSummary } from "./format";
import type { AccountUsage } from "./format";

describe("usageStatus", () => {
  it('returns "ok" when percent < 75', () => {
    expect(usageStatus(0)).toBe("ok");
    expect(usageStatus(74)).toBe("ok");
    expect(usageStatus(74.9)).toBe("ok");
  });

  it('returns "warn" when percent is 75~90', () => {
    expect(usageStatus(75)).toBe("warn");
    expect(usageStatus(80)).toBe("warn");
    expect(usageStatus(89)).toBe("warn");
    expect(usageStatus(90)).toBe("warn");
  });

  it('returns "danger" when percent > 90', () => {
    expect(usageStatus(91)).toBe("danger");
    expect(usageStatus(100)).toBe("danger");
  });
});

describe("computeSummary", () => {
  const ok: AccountUsage = { usage: { weekly: { usagePercent: 50 }, monthly: { usagePercent: 50 } } };
  const weeklyWarn: AccountUsage = { usage: { weekly: { usagePercent: 80 }, monthly: { usagePercent: 50 } } };
  const weeklyDanger: AccountUsage = { usage: { weekly: { usagePercent: 95 }, monthly: { usagePercent: 50 } } };
  const monthlyWarn: AccountUsage = { usage: { weekly: { usagePercent: 50 }, monthly: { usagePercent: 80 } } };
  const monthlyDanger: AccountUsage = { usage: { weekly: { usagePercent: 50 }, monthly: { usagePercent: 95 } } };
  const bothDanger: AccountUsage = { usage: { weekly: { usagePercent: 95 }, monthly: { usagePercent: 95 } } };
  const noUsage: AccountUsage = { usage: null };

  it("counts 0 when all accounts are ok", () => {
    const r = computeSummary([ok, ok]);
    expect(r).toEqual({ total: 2, weeklyWarn: 0, weeklyDanger: 0, monthlyWarn: 0, monthlyDanger: 0 });
  });

  it("counts weekly warn/danger separately", () => {
    const r = computeSummary([weeklyWarn, weeklyDanger]);
    expect(r).toEqual({ total: 2, weeklyWarn: 1, weeklyDanger: 1, monthlyWarn: 0, monthlyDanger: 0 });
  });

  it("counts monthly warn/danger separately", () => {
    const r = computeSummary([monthlyWarn, monthlyDanger]);
    expect(r).toEqual({ total: 2, weeklyWarn: 0, weeklyDanger: 0, monthlyWarn: 1, monthlyDanger: 1 });
  });

  it("handles mixed accounts", () => {
    const r = computeSummary([ok, weeklyWarn, monthlyDanger, bothDanger, noUsage]);
    expect(r).toEqual({ total: 5, weeklyWarn: 1, weeklyDanger: 1, monthlyWarn: 0, monthlyDanger: 2 });
  });

  it("skips null usage", () => {
    const r = computeSummary([noUsage, noUsage]);
    expect(r).toEqual({ total: 2, weeklyWarn: 0, weeklyDanger: 0, monthlyWarn: 0, monthlyDanger: 0 });
  });
});
