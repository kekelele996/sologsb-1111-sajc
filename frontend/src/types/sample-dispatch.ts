/** 样品类型 */
export type SampleType = '化学分析样' | '岩矿鉴定样' | '光片样' | '薄片样' | '物性测试样' | '外检样';

/** 送检状态：已送检 → 实验室已签收 → 已完成；中途可退回补采，补采后重新送检 */
export type SampleStatus = 'sent' | 'received' | 'returned' | 'completed';

/** 台账流转事件（送、收、退、补送、结） */
export interface SampleEvent {
  id: string;
  /** 事件类型，与送检状态一致 */
  type: SampleStatus;
  /** 发生时间 ISO */
  at: string;
  /** 经办人 */
  operator: string;
  /** 说明（退回原因 / 结果摘要等） */
  note?: string;
}

/** 送检台账记录：登记时从岩性区间快照孔号、深度与岩性 */
export interface SampleDispatch {
  id: string;
  /** 样品编号（唯一，取自岩性编录样品号） */
  sampleNo: string;
  /** 所属钻孔 */
  holeId: string;
  /** 来源岩性区间 id */
  lithoId: string;
  /** 起始深度快照（m） */
  fromDepth: number;
  /** 终止深度快照（m） */
  toDepth: number;
  /** 岩性快照 */
  lithology: string;
  /** 样品类型 */
  sampleType: SampleType;
  /** 样品重量（kg） */
  weight: number;
  /** 收样单位（实验室） */
  lab: string;
  /** 送样日期 ISO */
  sentAt: string;
  /** 预计回件日期 ISO */
  expectedAt: string;
  /** 送样人 */
  sender: string;
  /** 当前状态 */
  status: SampleStatus;
  /** 实验室签收日期 ISO */
  receivedAt?: string;
  /** 实验室签收人 */
  receiver?: string;
  /** 最近退回日期 ISO（补采重新送检后清空） */
  returnedAt?: string;
  /** 退回原因（退回必填） */
  returnReason?: string;
  /** 结果回录日期 ISO */
  resultAt?: string;
  /** 结果摘要（完成时必填） */
  resultSummary?: string;
  /** 流转记录 */
  events: SampleEvent[];
  /** 备注 */
  remark?: string;
}

export const SAMPLE_TYPES: SampleType[] = ['化学分析样', '岩矿鉴定样', '光片样', '薄片样', '物性测试样', '外检样'];

/** 常用收样单位（可手填其他单位） */
export const DEFAULT_LABS: string[] = ['省地质测试中心', '中实国联检测', '华勘岩矿鉴定室', '第三方外检实验室'];

/** 状态对应的标签文案与颜色 */
export const SAMPLE_STATUS_META: Record<SampleStatus, { label: string; color: string }> = {
  sent: { label: '已送检', color: 'blue' },
  received: { label: '实验室已签收', color: 'gold' },
  returned: { label: '退回补采', color: 'red' },
  completed: { label: '已完成', color: 'green' },
};
