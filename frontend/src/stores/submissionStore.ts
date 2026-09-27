import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { AssayType, SampleSubmission, SubmissionEvent, SubmissionEventType } from '../types/sample-submission';

export interface SubmissionInput {
  lithoId: string;
  assayType: AssayType;
  weightKg: number;
  receiverOrg: string;
  expectedAt: string;
  sentAt: string;
  sender: string;
  remark?: string;
}

export interface ReceiveInput {
  receivedAt: string;
  receivedBy: string;
  note?: string;
}

export interface ReturnInput {
  returnedAt: string;
  returnReason: string;
  operator: string;
}

export interface ResendInput {
  sentAt: string;
  expectedAt: string;
  receiverOrg: string;
  sender: string;
  weightKg: number;
  note?: string;
}

export interface ResultInput {
  resultAt: string;
  resultSummary: string;
  operator: string;
}

/** 状态流转非法时的错误 */
export class SubmissionStateError extends Error {}

interface SubmissionState {
  submissions: SampleSubmission[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 送检登记：样品号取自岩性区间，同一编号不能重复 */
  addSubmission: (
    input: SubmissionInput,
    litho: { id: string; holeId: string; sampleNo: string; fromDepth: number; toDepth: number },
  ) => Promise<SampleSubmission>;
  /** 登记实验室接收（仅待接收可操作） */
  markReceived: (id: string, input: ReceiveInput) => Promise<SampleSubmission>;
  /** 退回补采，必须填写退回原因（待接收 / 在检可退回） */
  markReturned: (id: string, input: ReturnInput) => Promise<SampleSubmission>;
  /** 补采后重新送检（仅退回补采可操作） */
  markResent: (id: string, input: ResendInput) => Promise<SampleSubmission>;
  /** 结果回录并完成（仅在检可操作，结果摘要必填） */
  recordResult: (id: string, input: ResultInput) => Promise<SampleSubmission>;
  removeSubmission: (id: string) => Promise<void>;
}

function eventOf(type: SubmissionEventType, at: string, operator: string, note?: string): SubmissionEvent {
  return { id: uid('evt'), type, at, operator: operator.trim(), note: note?.trim() || undefined };
}

/** 样品送检台账：登记 → 接收 → 退回补采 / 结果回录，全程留痕 */
export const useSubmissionStore = create<SubmissionState>()((set, get) => ({
  submissions: [],
  hydrated: false,

  hydrate: async () => {
    const submissions = await db.submissions.orderBy('sentAt').toArray();
    set({ submissions, hydrated: true });
  },

  addSubmission: async (input, litho) => {
    const sampleNo = litho.sampleNo.trim();
    if (!sampleNo) {
      throw new SubmissionStateError('该岩性区间未编录样品号，请先在岩性编录中补编号');
    }
    if (get().submissions.some((s) => s.sampleNo === sampleNo)) {
      throw new SubmissionStateError(`样品号 ${sampleNo} 已登记送检，同一编号不能重复登记`);
    }
    const sub: SampleSubmission = {
      id: uid('sub'),
      sampleNo,
      holeId: litho.holeId,
      lithoId: litho.id,
      fromDepth: litho.fromDepth,
      toDepth: litho.toDepth,
      assayType: input.assayType,
      weightKg: Number(input.weightKg) || 0,
      receiverOrg: input.receiverOrg.trim(),
      expectedAt: input.expectedAt,
      sender: input.sender.trim(),
      status: 'sent',
      sentAt: input.sentAt,
      remark: input.remark?.trim() || undefined,
      events: [eventOf('sent', input.sentAt, input.sender, input.remark)],
    };
    await db.submissions.put(sub);
    set({ submissions: [...get().submissions, sub] });
    return sub;
  },

  markReceived: async (id, input) => {
    const current = get().submissions.find((s) => s.id === id);
    if (!current) throw new SubmissionStateError('台账记录不存在');
    if (current.status !== 'sent') throw new SubmissionStateError('仅「待接收」状态可以登记接收');
    const next: SampleSubmission = {
      ...current,
      status: 'received',
      receivedAt: input.receivedAt,
      receivedBy: input.receivedBy.trim(),
      events: [...current.events, eventOf('received', input.receivedAt, input.receivedBy || current.sender, input.note)],
    };
    await db.submissions.put(next);
    set({ submissions: get().submissions.map((s) => (s.id === id ? next : s)) });
    return next;
  },

  markReturned: async (id, input) => {
    const current = get().submissions.find((s) => s.id === id);
    if (!current) throw new SubmissionStateError('台账记录不存在');
    if (current.status !== 'sent' && current.status !== 'received') {
      throw new SubmissionStateError('仅待接收 / 在检状态可以退回补采');
    }
    if (!input.returnReason.trim()) {
      throw new SubmissionStateError('退回必须填写原因');
    }
    const next: SampleSubmission = {
      ...current,
      status: 'returned',
      returnedAt: input.returnedAt,
      returnReason: input.returnReason.trim(),
      events: [...current.events, eventOf('returned', input.returnedAt, input.operator, input.returnReason)],
    };
    await db.submissions.put(next);
    set({ submissions: get().submissions.map((s) => (s.id === id ? next : s)) });
    return next;
  },

  markResent: async (id, input) => {
    const current = get().submissions.find((s) => s.id === id);
    if (!current) throw new SubmissionStateError('台账记录不存在');
    if (current.status !== 'returned') throw new SubmissionStateError('仅「退回补采」状态可以重新送检');
    const next: SampleSubmission = {
      ...current,
      status: 'sent',
      sentAt: input.sentAt,
      expectedAt: input.expectedAt,
      receiverOrg: input.receiverOrg.trim(),
      sender: input.sender.trim(),
      weightKg: Number(input.weightKg) || 0,
      receivedAt: undefined,
      receivedBy: undefined,
      returnedAt: undefined,
      returnReason: undefined,
      events: [...current.events, eventOf('resent', input.sentAt, input.sender, input.note)],
    };
    await db.submissions.put(next);
    set({ submissions: get().submissions.map((s) => (s.id === id ? next : s)) });
    return next;
  },

  recordResult: async (id, input) => {
    const current = get().submissions.find((s) => s.id === id);
    if (!current) throw new SubmissionStateError('台账记录不存在');
    if (current.status !== 'received') throw new SubmissionStateError('仅「在检」状态可以回录结果');
    if (!input.resultSummary.trim()) {
      throw new SubmissionStateError('完成时必须补结果摘要');
    }
    const next: SampleSubmission = {
      ...current,
      status: 'completed',
      resultAt: input.resultAt,
      resultSummary: input.resultSummary.trim(),
      events: [...current.events, eventOf('completed', input.resultAt, input.operator, input.resultSummary)],
    };
    await db.submissions.put(next);
    set({ submissions: get().submissions.map((s) => (s.id === id ? next : s)) });
    return next;
  },

  removeSubmission: async (id) => {
    await db.submissions.delete(id);
    set({ submissions: get().submissions.filter((s) => s.id !== id) });
  },
}));
