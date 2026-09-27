import dayjs from 'dayjs';
import type { DrillHole } from '../types/drill-hole';
import type { LithoLog } from '../types/litho-log';
import type { SampleDispatch, SampleStatus } from '../types/sample-dispatch';

/** 工作台四桶：待送（岩性已编样品号但未登记送检）/ 在检 / 退回 / 已完成 */
export type SampleBucket = 'pending' | SampleStatus;

export const SAMPLE_BUCKET_LABEL: Record<SampleBucket, string> = {
  pending: '待送',
  sent: '在检（已送检）',
  received: '在检（已签收）',
  returned: '退回补采',
  completed: '已完成',
};

/** 逾期类型：预计回件日已过仍未签收 / 已签收但仍未出结果 */
export type OverdueKind = 'receive' | 'result';

export interface OverdueSample {
  sample: SampleDispatch;
  kind: OverdueKind;
  /** 逾期天数（预计回件日相对今天） */
  days: number;
}

/**
 * 逾期判定：
 * - 已送检（实验室尚未签收）且已过预计回件日 → 逾期未接收
 * - 已签收（结果未回录）且已过预计回件日 → 逾期未出结果
 * 退回补采、已完成不提醒；预计回件日当天不算逾期。
 */
export function overdueOf(sample: SampleDispatch, now: dayjs.Dayjs = dayjs()): OverdueSample | undefined {
  if (sample.status !== 'sent' && sample.status !== 'received') return undefined;
  const due = dayjs(sample.expectedAt);
  const days = now.startOf('day').diff(due.startOf('day'), 'day');
  if (days <= 0) return undefined;
  return { sample, kind: sample.status === 'sent' ? 'receive' : 'result', days };
}

/** 岩性区间已编样品号但尚未登记送检（同一编号已登记即视为在流程中，不重复列出） */
export interface PendingLitho {
  litho: LithoLog;
  /** 同孔同样品号出现多段时，挂的代表区间（送检时一并快照） */
  ranges: Array<{ lithoId: string; from: number; to: number }>;
}

export function pendingLithos(lithos: LithoLog[], samples: SampleDispatch[]): PendingLitho[] {
  const usedLithoIds = new Set(samples.map((s) => s.lithoId));
  const usedSampleNos = new Set(samples.map((s) => s.sampleNo.trim()));
  const candidates = lithos.filter(
    (log) => log.sampleNo.trim() !== '' && !usedLithoIds.has(log.id) && !usedSampleNos.has(log.sampleNo.trim()),
  );
  const byKey = new Map<string, PendingLitho>();
  candidates.forEach((log) => {
    const key = `${log.holeId}@@${log.sampleNo.trim()}`;
    const item = byKey.get(key);
    const range = { lithoId: log.id, from: log.fromDepth, to: log.toDepth };
    if (item) {
      item.ranges.push(range);
    } else {
      byKey.set(key, { litho: log, ranges: [range] });
    }
  });
  return Array.from(byKey.values()).sort((a, b) =>
    a.litho.holeId === b.litho.holeId
      ? a.litho.fromDepth - b.litho.fromDepth
      : a.litho.holeId.localeCompare(b.litho.holeId),
  );
}

/** 单孔送检汇总（工作台按孔展示） */
export interface HoleSampleSummary {
  hole: DrillHole;
  pending: PendingLitho[];
  sent: SampleDispatch[];
  received: SampleDispatch[];
  returned: SampleDispatch[];
  completed: SampleDispatch[];
  overdue: OverdueSample[];
}

export function summarizeSamplesByHole(
  holes: DrillHole[],
  lithos: LithoLog[],
  samples: SampleDispatch[],
  now: dayjs.Dayjs = dayjs(),
): HoleSampleSummary[] {
  return holes.map((hole) => {
    const holeSamples = samples.filter((s) => s.holeId === hole.id);
    return {
      hole,
      pending: pendingLithos(
        lithos.filter((l) => l.holeId === hole.id),
        holeSamples,
      ),
      sent: holeSamples.filter((s) => s.status === 'sent'),
      received: holeSamples.filter((s) => s.status === 'received'),
      returned: holeSamples.filter((s) => s.status === 'returned'),
      completed: holeSamples.filter((s) => s.status === 'completed'),
      overdue: holeSamples
        .map((s) => overdueOf(s, now))
        .filter((item): item is OverdueSample => item !== undefined),
    };
  });
}

/** 状态流转前置校验：返回错误文案，undefined 表示允许 */
export function transitionError(status: SampleStatus, action: SampleStatus): string | undefined {
  if (action === 'received' && status !== 'sent') return '仅「已送检」的样品可登记实验室签收';
  if (action === 'returned' && status !== 'sent' && status !== 'received') return '仅送检中的样品可退回补采';
  if (action === 'sent' && status !== 'returned') return '仅「退回补采」的样品可重新送检';
  if (action === 'completed' && status !== 'received') return '需先登记实验室签收，再回录结果完成';
  return undefined;
}
