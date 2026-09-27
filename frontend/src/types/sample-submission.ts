/** 样品类型（分析测试类别） */
export type AssayType = '基本分析(化学样)' | '组合分析' | '物相分析' | '岩石力学' | '薄片鉴定';

/** 送检状态：sent 待接收 → received 在检 → completed 已完成；returned 退回补采（补采后可重新送检） */
export type SubmissionStatus = 'sent' | 'received' | 'returned' | 'completed';

/** 台账事件类型（全过程流水） */
export type SubmissionEventType = 'sent' | 'received' | 'returned' | 'resent' | 'completed';

/** 送检台账事件 */
export interface SubmissionEvent {
  id: string;
  type: SubmissionEventType;
  /** 发生时间 ISO */
  at: string;
  /** 操作人 */
  operator: string;
  /** 说明（退回原因 / 接收备注等） */
  note?: string;
}

/** 样品送检台账（一条记录对应一个已编号岩性样品） */
export interface SampleSubmission {
  id: string;
  /** 样品号（取自岩性编录区间，全库唯一，不可重复登记） */
  sampleNo: string;
  /** 所属钻孔（冗余自岩性区间，便于按孔汇总） */
  holeId: string;
  /** 关联岩性编录区间 */
  lithoId: string;
  /** 取样起始深度（m，冗余自岩性区间） */
  fromDepth: number;
  /** 取样终止深度（m，冗余自岩性区间） */
  toDepth: number;
  /** 样品类型 */
  assayType: AssayType;
  /** 样品重量（kg） */
  weightKg: number;
  /** 收样单位 */
  receiverOrg: string;
  /** 预计回件日期 ISO */
  expectedAt: string;
  /** 送样人 */
  sender: string;
  /** 当前状态 */
  status: SubmissionStatus;
  /** 送检日期 ISO */
  sentAt: string;
  /** 实验室接收日期 ISO */
  receivedAt?: string;
  /** 收样人 */
  receivedBy?: string;
  /** 退回日期 ISO */
  returnedAt?: string;
  /** 退回原因（退回必填） */
  returnReason?: string;
  /** 结果回录日期 ISO */
  resultAt?: string;
  /** 结果摘要（完成时必填） */
  resultSummary?: string;
  /** 备注 */
  remark?: string;
  /** 全过程事件流水 */
  events: SubmissionEvent[];
}

export const ASSAY_TYPES: AssayType[] = ['基本分析(化学样)', '组合分析', '物相分析', '岩石力学', '薄片鉴定'];

/** 常用收样单位（AutoComplete 候选，可手填其他单位） */
export const SUBMISSION_ORGS: string[] = ['省岩矿测试中心', '中南地质实验室', '华北物化探测试所'];

export const SUBMISSION_STATUS_META: Record<SubmissionStatus, { label: string; color: string }> = {
  sent: { label: '待接收', color: 'orange' },
  received: { label: '在检', color: 'blue' },
  returned: { label: '退回补采', color: 'red' },
  completed: { label: '已完成', color: 'green' },
};

export const EVENT_TEXT: Record<SubmissionEventType, string> = {
  sent: '送检登记',
  received: '实验室接收',
  returned: '退回补采',
  resent: '补采后重新送检',
  completed: '结果回录',
};
