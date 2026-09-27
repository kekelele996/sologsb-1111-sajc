import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { SampleDispatch, SampleEvent, SampleStatus, SampleType } from '../types/sample-dispatch';
import { transitionError } from '../utils/sample';
import type { LithoLog } from '../types/litho-log';

export interface DispatchInput {
  /** 来源岩性区间 id（编号、孔号、深度、岩性从该区间快照） */
  lithoId: string;
  sampleType: SampleType;
  weight: number;
  lab: string;
  sentAt: string;
  expectedAt: string;
  sender: string;
  remark?: string;
}

interface SampleState {
  samples: SampleDispatch[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 登记送检：编号重复 / 区间不存在时返回错误文案 */
  addDispatch: (input: DispatchInput, litho: LithoLog) => Promise<{ sample?: SampleDispatch; error?: string }>;
  updateDispatch: (id: string, patch: Partial<Omit<SampleDispatch, 'id' | 'sampleNo' | 'events'>>) => Promise<void>;
  removeDispatch: (id: string) => Promise<void>;
  /** 登记实验室签收 */
  markReceived: (id: string, input: { receivedAt: string; receiver: string }) => Promise<{ error?: string }>;
  /** 退回补采（原因必填） */
  markReturned: (id: string, input: { returnedAt: string; operator: string; reason: string }) => Promise<{ error?: string }>;
  /** 补采后重新送检 */
  resend: (id: string, input: { sentAt: string; expectedAt: string; lab: string; sender: string; weight: number }) => Promise<{ error?: string }>;
  /** 结果回录并完成（结果摘要必填） */
  complete: (id: string, input: { resultAt: string; resultSummary: string }) => Promise<{ error?: string }>;
}

function nextEvent(type: SampleStatus, at: string, operator: string, note?: string): SampleEvent {
  return { id: uid('evt'), type, at, operator, note: note?.trim() || undefined };
}

/** 送检台账与状态流转 */
export const useSampleStore = create<SampleState>()((set, get) => ({
  samples: [],
  hydrated: false,

  hydrate: async () => {
    const samples = await db.samples.orderBy('sampleNo').toArray();
    set({ samples, hydrated: true });
  },

  addDispatch: async (input, litho) => {
    const sampleNo = litho.sampleNo.trim();
    if (!sampleNo) return { error: '该岩性区间未编样品号，请先在岩性编录中补登样品号' };
    const duplicate = get().samples.some((s) => s.sampleNo === sampleNo);
    if (duplicate) return { error: `样品编号 ${sampleNo} 已登记送检，同一编号不能重复` };
    if (!input.lab.trim()) return { error: '请填写收样单位' };
    if (!(Number(input.weight) > 0)) return { error: '样品重量需大于 0' };
    const sample: SampleDispatch = {
      id: uid('smp'),
      sampleNo,
      holeId: litho.holeId,
      lithoId: litho.id,
      fromDepth: litho.fromDepth,
      toDepth: litho.toDepth,
      lithology: litho.lithology,
      sampleType: input.sampleType,
      weight: Number(input.weight),
      lab: input.lab.trim(),
      sentAt: input.sentAt,
      expectedAt: input.expectedAt,
      sender: input.sender.trim(),
      status: 'sent',
      events: [nextEvent('sent', input.sentAt, input.sender.trim(), `送 ${input.lab.trim()}`)],
      remark: input.remark?.trim() || undefined,
    };
    await db.samples.put(sample);
    set({ samples: [...get().samples, sample].sort((a, b) => a.sampleNo.localeCompare(b.sampleNo)) });
    return { sample };
  },

  updateDispatch: async (id, patch) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) return;
    const next: SampleDispatch = { ...current, ...patch };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === id ? next : s)) });
  },

  removeDispatch: async (id) => {
    await db.samples.delete(id);
    set({ samples: get().samples.filter((s) => s.id !== id) });
  },

  markReceived: async (id, input) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) return { error: '记录不存在' };
    const guard = transitionError(current.status, 'received');
    if (guard) return { error: guard };
    const next: SampleDispatch = {
      ...current,
      status: 'received',
      receivedAt: input.receivedAt,
      receiver: input.receiver.trim(),
      events: [...current.events, nextEvent('received', input.receivedAt, input.receiver.trim(), '实验室签收')],
    };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === id ? next : s)) });
    return {};
  },

  markReturned: async (id, input) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) return { error: '记录不存在' };
    const guard = transitionError(current.status, 'returned');
    if (guard) return { error: guard };
    if (!input.reason.trim()) return { error: '退回补采必须填写退回原因' };
    const next: SampleDispatch = {
      ...current,
      status: 'returned',
      returnedAt: input.returnedAt,
      returnReason: input.reason.trim(),
      events: [...current.events, nextEvent('returned', input.returnedAt, input.operator.trim(), input.reason)],
    };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === id ? next : s)) });
    return {};
  },

  resend: async (id, input) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) return { error: '记录不存在' };
    const guard = transitionError(current.status, 'sent');
    if (guard) return { error: guard };
    if (!input.lab.trim()) return { error: '请填写收样单位' };
    if (!(Number(input.weight) > 0)) return { error: '样品重量需大于 0' };
    const next: SampleDispatch = {
      ...current,
      status: 'sent',
      sampleType: current.sampleType,
      weight: Number(input.weight),
      lab: input.lab.trim(),
      sentAt: input.sentAt,
      expectedAt: input.expectedAt,
      sender: input.sender.trim(),
      receivedAt: undefined,
      receiver: undefined,
      returnedAt: undefined,
      returnReason: undefined,
      resultAt: undefined,
      resultSummary: undefined,
      events: [...current.events, nextEvent('sent', input.sentAt, input.sender.trim(), `补采后重新送 ${input.lab.trim()}`)],
    };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === id ? next : s)) });
    return {};
  },

  complete: async (id, input) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) return { error: '记录不存在' };
    const guard = transitionError(current.status, 'completed');
    if (guard) return { error: guard };
    if (!input.resultSummary.trim()) return { error: '完成时必须补录结果摘要' };
    const next: SampleDispatch = {
      ...current,
      status: 'completed',
      resultAt: input.resultAt,
      resultSummary: input.resultSummary.trim(),
      events: [...current.events, nextEvent('completed', input.resultAt, current.receiver ?? current.sender, input.resultSummary)],
    };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === id ? next : s)) });
    return {};
  },
}));
