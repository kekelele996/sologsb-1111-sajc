import dayjs from 'dayjs';
import type { DrillHole } from '../types/drill-hole';
import type { LithoLog } from '../types/litho-log';
import type { SampleSubmission, SubmissionStatus } from '../types/sample-submission';

/** 可送检岩性区间：样品号非空且该样品号尚无台账记录 */
export function pendingLithos(lithos: LithoLog[], submissions: SampleSubmission[]): LithoLog[] {
  const used = new Set(submissions.map((s) => s.sampleNo));
  return lithos
    .filter((log) => log.sampleNo.trim().length > 0 && !used.has(log.sampleNo.trim()))
    .sort((a, b) => (a.holeId === b.holeId ? a.fromDepth - b.fromDepth : a.holeId.localeCompare(b.holeId)));
}

/** 逾期类型：sent 超过预计回件日仍未接收；received 超过预计回件日仍未出结果 */
export type OverdueKind = 'overdueReceive' | 'overdueResult';

export interface OverdueMark {
  kind: OverdueKind;
  /** 逾期天数（超过预计回件日的天数） */
  days: number;
}

/** 逾期判定：以预计回件日期为统一期限，退回补采与已完成不提醒 */
export function overdueOf(sub: SampleSubmission, now: dayjs.Dayjs = dayjs()): OverdueMark | null {
  if (sub.status !== 'sent' && sub.status !== 'received') return null;
  const expected = dayjs(sub.expectedAt);
  const days = now.startOf('day').diff(expected.startOf('day'), 'day');
  if (days <= 0) return null;
  return { kind: sub.status === 'sent' ? 'overdueReceive' : 'overdueResult', days };
}

/** 工作台按孔汇总（待送数取岩性已编号但未登记送检的去重样品） */
export interface HoleSubmissionSummary {
  hole: DrillHole;
  pending: number;
  sent: number;
  received: number;
  returned: number;
  completed: number;
  /** 逾期未接收 + 逾期未出结果 */
  overdue: SampleSubmission[];
}

export function submissionSummaryByHole(
  holes: DrillHole[],
  lithos: LithoLog[],
  submissions: SampleSubmission[],
  now: dayjs.Dayjs = dayjs(),
): HoleSubmissionSummary[] {
  const used = new Set(submissions.map((s) => s.sampleNo));
  return holes.map((hole) => {
    const holeLithos = lithos.filter((log) => log.holeId === hole.id && log.sampleNo.trim() && !used.has(log.sampleNo.trim()));
    const pending = new Set(holeLithos.map((log) => log.sampleNo.trim())).size;
    const holeSubs = submissions.filter((sub) => sub.holeId === hole.id);
    const count = (status: SubmissionStatus) => holeSubs.filter((sub) => sub.status === status).length;
    return {
      hole,
      pending,
      sent: count('sent'),
      received: count('received'),
      returned: count('returned'),
      completed: count('completed'),
      overdue: holeSubs.filter((sub) => overdueOf(sub, now)),
    };
  });
}

/** 逾期明细（未接收 / 未出结果） */
export function overdueList(submissions: SampleSubmission[], now: dayjs.Dayjs = dayjs()) {
  return {
    receive: submissions.filter((sub) => overdueOf(sub, now)?.kind === 'overdueReceive'),
    result: submissions.filter((sub) => overdueOf(sub, now)?.kind === 'overdueResult'),
  };
}
