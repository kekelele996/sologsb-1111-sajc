import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { DownloadOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import { useHoleStore } from '../stores/holeStore';
import { useLithoStore } from '../stores/lithoStore';
import { useSampleStore, type DispatchInput } from '../stores/sampleStore';
import {
  DEFAULT_LABS,
  SAMPLE_STATUS_META,
  SAMPLE_TYPES,
  type SampleDispatch,
  type SampleStatus,
  type SampleType,
} from '../types/sample-dispatch';
import { overdueOf, pendingLithos, type OverdueSample, type PendingLitho } from '../utils/sample';
import { downloadCsv } from '../utils/export';

const { Title, Paragraph, Text } = Typography;

type ModalMode = 'create' | 'edit' | 'receive' | 'return' | 'resend' | 'complete' | null;

interface DispatchFormValues {
  holeId: string;
  lithoId: string;
  sampleType: SampleType;
  weight: number;
  lab: string;
  sentAt: Dayjs;
  expectedAt: Dayjs;
  sender: string;
  remark?: string;
}

interface ReceiveFormValues {
  receivedAt: Dayjs;
  receiver: string;
}

interface ReturnFormValues {
  returnedAt: Dayjs;
  operator: string;
  reason: string;
}

interface ResendFormValues {
  sentAt: Dayjs;
  expectedAt: Dayjs;
  lab: string;
  weight: number;
  sender: string;
}

interface CompleteFormValues {
  resultAt: Dayjs;
  resultSummary: string;
}

/** 台账行：待送行由岩性区间派生，其余来自送检记录 */
interface LedgerRow {
  key: string;
  pending?: PendingLitho;
  dispatch?: SampleDispatch;
  status: SampleStatus | 'pending';
}

const STATUS_FILTER_OPTIONS: Array<{ label: string; value: SampleStatus }> = (
  ['sent', 'received', 'returned', 'completed'] as SampleStatus[]
).map((value) => ({ label: SAMPLE_STATUS_META[value].label, value }));

/** 送检台账：登记 → 签收 → 结果回录，支持退回补采，逾期单独提醒 */
export default function SampleLedger() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const lithos = useLithoStore((s) => s.lithos);
  const samples = useSampleStore((s) => s.samples);
  const addDispatch = useSampleStore((s) => s.addDispatch);
  const updateDispatch = useSampleStore((s) => s.updateDispatch);
  const removeDispatch = useSampleStore((s) => s.removeDispatch);
  const markReceived = useSampleStore((s) => s.markReceived);
  const markReturned = useSampleStore((s) => s.markReturned);
  const resend = useSampleStore((s) => s.resend);
  const complete = useSampleStore((s) => s.complete);

  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<ModalMode>(null);
  const [active, setActive] = useState<SampleDispatch | null>(null);
  const [createHoleId, setCreateHoleId] = useState('');
  const [dispatchForm] = Form.useForm<DispatchFormValues>();
  const [receiveForm] = Form.useForm<ReceiveFormValues>();
  const [returnForm] = Form.useForm<ReturnFormValues>();
  const [resendForm] = Form.useForm<ResendFormValues>();
  const [completeForm] = Form.useForm<CompleteFormValues>();

  const holeNoOf = (holeId: string) => holes.find((h) => h.id === holeId)?.holeNo ?? '未知孔';
  const holeOptions = holes.map((hole) => ({ label: `${hole.holeNo} · 设计 ${hole.designDepth}m`, value: hole.id }));
  const labOptions = useMemo(
    () => Array.from(new Set([...DEFAULT_LABS, ...samples.map((s) => s.lab)])),
    [samples],
  );

  const pending = useMemo(() => pendingLithos(lithos, samples), [lithos, samples]);

  /** 全局统计（不随筛选变化） */
  const counts = useMemo(
    () => ({
      pending: pending.length,
      sent: samples.filter((s) => s.status === 'sent').length,
      received: samples.filter((s) => s.status === 'received').length,
      returned: samples.filter((s) => s.status === 'returned').length,
      completed: samples.filter((s) => s.status === 'completed').length,
    }),
    [pending, samples],
  );

  const kw = (params.get('kw') ?? '').trim();
  const holeFilter = params.get('hole') ?? '';
  const statusFilter = params.get('status') ?? '';
  const labFilter = params.get('lab') ?? '';

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const resetFilters = () => setParams(new URLSearchParams(), { replace: true });
  const filterActiveCount = [kw, holeFilter, statusFilter, labFilter].filter(Boolean).length;

  const matchKeyword = (text: string) => !kw || text.toLowerCase().includes(kw.toLowerCase());

  /** 逾期清单：不受状态筛选影响（孔号 / 实验室 / 关键字仍生效），确保始终提醒 */
  const overdueList = useMemo<OverdueSample[]>(() => {
    return samples
      .filter((s) => !holeFilter || s.holeId === holeFilter)
      .filter((s) => !labFilter || s.lab === labFilter)
      .filter((s) =>
        matchKeyword(`${s.sampleNo} ${holeNoOf(s.holeId)} ${s.lab} ${s.sampleType} ${s.lithology} ${s.resultSummary ?? ''}`),
      )
      .map((s) => overdueOf(s))
      .filter((item): item is OverdueSample => item !== undefined)
      .sort((a, b) => b.days - a.days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, holeFilter, labFilter, kw, holes]);

  const rows = useMemo<LedgerRow[]>(() => {
    const pendingRows: LedgerRow[] = pending
      .filter((p) => !holeFilter || p.litho.holeId === holeFilter)
      .filter((p) => !labFilter)
      .filter((p) => (!statusFilter ? true : statusFilter === 'pending'))
      .filter((p) =>
        matchKeyword(`${p.litho.sampleNo} ${holeNoOf(p.litho.holeId)} ${p.litho.lithology} ${p.litho.remark ?? ''}`),
      )
      .map((p) => ({ key: `pending-${p.litho.id}`, pending: p, status: 'pending' as const }));

    const dispatchRows: LedgerRow[] = samples
      .filter((s) => !holeFilter || s.holeId === holeFilter)
      .filter((s) => !statusFilter || s.status === statusFilter)
      .filter((s) => !labFilter || s.lab === labFilter)
      .filter((s) =>
        matchKeyword(
          `${s.sampleNo} ${holeNoOf(s.holeId)} ${s.lab} ${s.sampleType} ${s.lithology} ${s.sender} ${s.receiver ?? ''} ${s.returnReason ?? ''} ${s.resultSummary ?? ''} ${s.remark ?? ''}`,
        ),
      )
      .map((s) => ({ key: s.id, dispatch: s, status: s.status }))
      .sort((a, b) => (a.dispatch!.sampleNo < b.dispatch!.sampleNo ? -1 : 1));

    return [...pendingRows, ...dispatchRows];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, samples, kw, holeFilter, statusFilter, labFilter, holes]);

  // ---------- 弹窗 ----------
  const closeModal = () => {
    setMode(null);
    setActive(null);
  };

  const openCreate = (preset?: PendingLitho) => {
    const firstPendingHoleId = pending[0]?.litho.holeId ?? '';
    const targetHoleId = preset?.litho.holeId ?? (createHoleId || firstPendingHoleId || holes[0]?.id || '');
    setCreateHoleId(targetHoleId);
    setMode('create');
    dispatchForm.resetFields();
    const holePending = pending.filter((p) => p.litho.holeId === targetHoleId);
    dispatchForm.setFieldsValue({
      holeId: targetHoleId,
      lithoId: preset?.litho.id ?? holePending[0]?.litho.id,
      sampleType: '化学分析样',
      weight: 2,
      lab: DEFAULT_LABS[0],
      sentAt: dayjs(),
      expectedAt: dayjs().add(14, 'day'),
      sender: '陈立',
    } as unknown as DispatchFormValues);
  };

  const lithoOptionsForHole = (holeId: string) =>
    pending
      .filter((p) => p.litho.holeId === holeId)
      .map((p) => ({
        label: `${p.litho.sampleNo}（${p.litho.fromDepth}~${p.litho.toDepth}m · ${p.litho.lithology}）`,
        value: p.litho.id,
      }));

  const submitCreate = async () => {
    const values = await dispatchForm.validateFields();
    if (!values.expectedAt.isAfter(values.sentAt.startOf('day'))) {
      message.error('预计回件日期需晚于送样日期');
      return;
    }
    const litho = lithos.find((l) => l.id === values.lithoId);
    if (!litho) {
      message.error('请选择已编样品号且尚未送检的岩性区间');
      return;
    }
    const input: DispatchInput = {
      lithoId: litho.id,
      sampleType: values.sampleType,
      weight: Number(values.weight) || 0,
      lab: values.lab,
      sentAt: values.sentAt.toISOString(),
      expectedAt: values.expectedAt.toISOString(),
      sender: values.sender,
      remark: values.remark,
    };
    const result = await addDispatch(input, litho);
    if (result.error) {
      message.error(result.error);
      return;
    }
    message.success(`已登记送检 ${litho.sampleNo} → ${input.lab}`);
    closeModal();
  };

  const openEdit = (record: SampleDispatch) => {
    setActive(record);
    setMode('edit');
    dispatchForm.resetFields();
    dispatchForm.setFieldsValue({
      sampleType: record.sampleType,
      weight: record.weight,
      lab: record.lab,
      sentAt: dayjs(record.sentAt),
      expectedAt: dayjs(record.expectedAt),
      sender: record.sender,
      remark: record.remark,
    } as unknown as DispatchFormValues);
  };

  const submitEdit = async () => {
    if (!active) return;
    const values = await dispatchForm.validateFields();
    if (!values.expectedAt.isAfter(values.sentAt.startOf('day'))) {
      message.error('预计回件日期需晚于送样日期');
      return;
    }
    await updateDispatch(active.id, {
      sampleType: values.sampleType,
      weight: Number(values.weight) || 0,
      lab: values.lab.trim(),
      sentAt: values.sentAt.toISOString(),
      expectedAt: values.expectedAt.toISOString(),
      sender: values.sender.trim(),
      remark: values.remark?.trim() || undefined,
    });
    message.success(`已更新送检登记 ${active.sampleNo}`);
    closeModal();
  };

  const openReceive = (record: SampleDispatch) => {
    setActive(record);
    setMode('receive');
    receiveForm.resetFields();
    receiveForm.setFieldsValue({ receivedAt: dayjs(), receiver: '' } as unknown as ReceiveFormValues);
  };

  const submitReceive = async () => {
    if (!active) return;
    const values = await receiveForm.validateFields();
    const result = await markReceived(active.id, { receivedAt: values.receivedAt.toISOString(), receiver: values.receiver });
    if (result.error) {
      message.error(result.error);
      return;
    }
    message.success(`已登记 ${active.sampleNo} 实验室签收`);
    closeModal();
  };

  const openReturn = (record: SampleDispatch) => {
    setActive(record);
    setMode('return');
    returnForm.resetFields();
    returnForm.setFieldsValue({ returnedAt: dayjs(), operator: record.receiver ?? '' } as unknown as ReturnFormValues);
  };

  const submitReturn = async () => {
    if (!active) return;
    const values = await returnForm.validateFields();
    const result = await markReturned(active.id, {
      returnedAt: values.returnedAt.toISOString(),
      operator: values.operator,
      reason: values.reason,
    });
    if (result.error) {
      message.error(result.error);
      return;
    }
    message.success(`已登记 ${active.sampleNo} 退回补采`);
    closeModal();
  };

  const openResend = (record: SampleDispatch) => {
    setActive(record);
    setMode('resend');
    resendForm.resetFields();
    resendForm.setFieldsValue({
      sentAt: dayjs(),
      expectedAt: dayjs().add(14, 'day'),
      lab: record.lab,
      weight: record.weight,
      sender: record.sender,
    } as unknown as ResendFormValues);
  };

  const submitResend = async () => {
    if (!active) return;
    const values = await resendForm.validateFields();
    if (!values.expectedAt.isAfter(values.sentAt.startOf('day'))) {
      message.error('预计回件日期需晚于送样日期');
      return;
    }
    const result = await resend(active.id, {
      sentAt: values.sentAt.toISOString(),
      expectedAt: values.expectedAt.toISOString(),
      lab: values.lab,
      weight: Number(values.weight) || 0,
      sender: values.sender,
    });
    if (result.error) {
      message.error(result.error);
      return;
    }
    message.success(`${active.sampleNo} 补采后已重新送检`);
    closeModal();
  };

  const openComplete = (record: SampleDispatch) => {
    setActive(record);
    setMode('complete');
    completeForm.resetFields();
    completeForm.setFieldsValue({ resultAt: dayjs(), resultSummary: '' } as unknown as CompleteFormValues);
  };

  const submitComplete = async () => {
    if (!active) return;
    const values = await completeForm.validateFields();
    const result = await complete(active.id, { resultAt: values.resultAt.toISOString(), resultSummary: values.resultSummary });
    if (result.error) {
      message.error(result.error);
      return;
    }
    message.success(`已回录 ${active.sampleNo} 结果并完成`);
    closeModal();
  };

  const handleExport = () => {
    const exportRows = rows
      .map((row) => row.dispatch)
      .filter((s): s is SampleDispatch => Boolean(s));
    if (!exportRows.length) {
      message.warning('当前筛选结果无可导出的送检记录（待送行请先登记送检）');
      return;
    }
    downloadCsv<Record<string, unknown>>(
      `送检台账-${new Date().toISOString().slice(0, 10)}.csv`,
      exportRows.map((s) => ({
        sampleNo: s.sampleNo,
        holeNo: holeNoOf(s.holeId),
        range: `${s.fromDepth}~${s.toDepth}`,
        lithology: s.lithology,
        sampleType: s.sampleType,
        weight: s.weight,
        lab: s.lab,
        status: SAMPLE_STATUS_META[s.status].label,
        sentAt: dayjs(s.sentAt).format('YYYY-MM-DD'),
        expectedAt: dayjs(s.expectedAt).format('YYYY-MM-DD'),
        receivedAt: s.receivedAt ? dayjs(s.receivedAt).format('YYYY-MM-DD') : '',
        receiver: s.receiver ?? '',
        returnedAt: s.returnedAt ? dayjs(s.returnedAt).format('YYYY-MM-DD') : '',
        returnReason: s.returnReason ?? '',
        resultAt: s.resultAt ? dayjs(s.resultAt).format('YYYY-MM-DD') : '',
        resultSummary: s.resultSummary ?? '',
      })),
      [
        { key: 'sampleNo', title: '样品编号' },
        { key: 'holeNo', title: '孔号' },
        { key: 'range', title: '深度区间(m)' },
        { key: 'lithology', title: '岩性' },
        { key: 'sampleType', title: '样品类型' },
        { key: 'weight', title: '重量(kg)' },
        { key: 'lab', title: '收样单位' },
        { key: 'status', title: '状态' },
        { key: 'sentAt', title: '送样日期' },
        { key: 'expectedAt', title: '预计回件日期' },
        { key: 'receivedAt', title: '签收日期' },
        { key: 'receiver', title: '签收人' },
        { key: 'returnedAt', title: '退回日期' },
        { key: 'returnReason', title: '退回原因' },
        { key: 'resultAt', title: '结果日期' },
        { key: 'resultSummary', title: '结果摘要' },
      ],
    );
    message.success(`已导出当前筛选结果 ${exportRows.length} 条送检记录（CSV）`);
  };

  // ---------- 表格 ----------
  const statusTag = (status: SampleStatus | 'pending') =>
    status === 'pending' ? (
      <Tag color="default">待送</Tag>
    ) : (
      <Tag color={SAMPLE_STATUS_META[status].color}>{SAMPLE_STATUS_META[status].label}</Tag>
    );

  const overdueTagOf = (s: SampleDispatch) => {
    const overdue = overdueOf(s);
    if (!overdue) return null;
    return (
      <Tag color="red" style={{ marginLeft: 6 }}>
        {overdue.kind === 'receive' ? `逾期未接收 ${overdue.days} 天` : `逾期未出结果 ${overdue.days} 天`}
      </Tag>
    );
  };

  const columns: TableColumnsType<LedgerRow> = [
    {
      title: '样品编号',
      width: 140,
      render: (_, row) => <Text strong>{row.pending ? row.pending.litho.sampleNo : row.dispatch!.sampleNo}</Text>,
    },
    { title: '孔号', width: 100, render: (_, row) => holeNoOf(row.pending ? row.pending.litho.holeId : row.dispatch!.holeId) },
    {
      title: '深度区间(m)',
      width: 130,
      render: (_, row) => {
        const p = row.pending;
        if (p && p.ranges.length > 1) {
          return <MergedRangesTag ranges={p.ranges} />;
        }
        const from = p ? p.litho.fromDepth : row.dispatch!.fromDepth;
        const to = p ? p.litho.toDepth : row.dispatch!.toDepth;
        return `${from}~${to}`;
      },
    },
    { title: '岩性', width: 120, render: (_, row) => (row.pending ? row.pending.litho.lithology : row.dispatch!.lithology) },
    { title: '类型', width: 110, render: (_, row) => row.dispatch?.sampleType ?? '-' },
    { title: '重量(kg)', width: 90, align: 'right', render: (_, row) => row.dispatch?.weight ?? '-' },
    { title: '收样单位', width: 140, render: (_, row) => row.dispatch?.lab ?? '-' },
    {
      title: '送样/预计回件',
      width: 190,
      render: (_, row) =>
        row.dispatch ? (
          <span>
            {dayjs(row.dispatch.sentAt).format('MM-DD')} / {dayjs(row.dispatch.expectedAt).format('MM-DD')}
          </span>
        ) : (
          '-'
        ),
    },
    {
      title: '状态',
      width: 250,
      render: (_, row) => (
        <span>
          {statusTag(row.status)}
          {row.dispatch ? overdueTagOf(row.dispatch) : null}
        </span>
      ),
    },
    {
      title: '结果摘要',
      ellipsis: true,
      render: (_, row) => row.dispatch?.resultSummary ?? (row.pending ? <Text type="secondary">岩性已编号，尚未登记送检</Text> : '-'),
    },
    {
      title: '操作',
      width: 250,
      fixed: 'right',
      render: (_, row) => {
        if (row.pending) {
          return (
            <Button size="small" type="link" icon={<SendOutlined />} onClick={() => openCreate(row.pending)}>
              登记送检
            </Button>
          );
        }
        const s = row.dispatch!;
        return (
          <Space size={0} wrap>
            {s.status === 'sent' ? (
              <>
                <Button size="small" type="link" onClick={() => openReceive(s)}>
                  登记接收
                </Button>
                <Button size="small" type="link" danger onClick={() => openReturn(s)}>
                  退回补采
                </Button>
              </>
            ) : null}
            {s.status === 'received' ? (
              <>
                <Button size="small" type="link" onClick={() => openComplete(s)}>
                  结果回录
                </Button>
                <Button size="small" type="link" danger onClick={() => openReturn(s)}>
                  退回补采
                </Button>
              </>
            ) : null}
            {s.status === 'returned' ? (
              <Button size="small" type="link" onClick={() => openResend(s)}>
                重新送检
              </Button>
            ) : null}
            {s.status !== 'completed' ? (
              <Button size="small" type="link" onClick={() => openEdit(s)}>
                编辑
              </Button>
            ) : null}
            <Popconfirm
              title={`确认删除送检记录 ${s.sampleNo}？删除后该编号可重新登记送检`}
              onConfirm={() => removeDispatch(s.id).then(() => message.success('已删除'))}
            >
              <Button size="small" type="link" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const createHoleOptions = lithoOptionsForHole(createHoleId);

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        送检台账
      </Title>
      <Paragraph type="secondary">
        送检时选择已有岩性区间（自动带出样品号、孔号、深度与岩性），登记类型、重量、收样单位与预计回件日期；随后登记实验室接收、退回补采（必填原因）与结果回录。同一编号不可重复登记。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={8} xl={4}>
          <StatBadge label="待送" value={counts.pending} unit="件" status="default" hint="岩性已编样品号但尚未登记送检" />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatBadge label="在检" value={counts.sent + counts.received} unit="件" status="warning" hint="已送检 + 实验室已签收" />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatBadge label="退回补采" value={counts.returned} unit="件" status={counts.returned ? 'error' : 'success'} />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatBadge label="已完成" value={counts.completed} unit="件" status="success" />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatBadge label="逾期未接收" value={overdueList.filter((o) => o.kind === 'receive').length} unit="件" status={overdueList.some((o) => o.kind === 'receive') ? 'error' : 'success'} hint="已过预计回件日实验室仍未签收" />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <StatBadge label="逾期未出结果" value={overdueList.filter((o) => o.kind === 'result').length} unit="件" status={overdueList.some((o) => o.kind === 'result') ? 'error' : 'success'} hint="实验室已签收但已过预计回件日仍未回录结果" />
        </Col>
      </Row>

      {overdueList.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          message={`送检逾期提醒：${overdueList.length} 件样品${
            overdueList.some((o) => o.kind === 'receive') ? '实验室未接收' : ''
          }${overdueList.some((o) => o.kind === 'receive') && overdueList.some((o) => o.kind === 'result') ? '或' : ''}${
            overdueList.some((o) => o.kind === 'result') ? '未出结果' : ''
          }（预计回件日已过）`}
          description={
            <Space wrap>
              {overdueList.map(({ sample, kind, days }) => (
                <Tag key={sample.id} color="red">
                  {holeNoOf(sample.holeId)} · {sample.sampleNo}（{kind === 'receive' ? `未接收 ${days} 天` : `未出结果 ${days} 天`}，应于{' '}
                  {dayjs(sample.expectedAt).format('YYYY-MM-DD')} 回件）
                </Tag>
              ))}
            </Space>
          }
        />
      ) : null}

      <Space style={{ marginBottom: 12 }} wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()} disabled={!holes.length}>
          登记送检
        </Button>
        <Input.Search
          allowClear
          style={{ width: 230 }}
          placeholder="搜索编号 / 孔号 / 实验室 / 摘要"
          defaultValue={kw}
          key={kw}
          onSearch={(value) => updateParam('kw', value.trim())}
        />
        <span style={{ color: '#6b7a86' }}>钻孔</span>
        <Select
          allowClear
          style={{ width: 190 }}
          placeholder="全部钻孔"
          value={holeFilter || undefined}
          options={holeOptions}
          onChange={(value?: string) => updateParam('hole', value ?? '')}
        />
        <span style={{ color: '#6b7a86' }}>状态</span>
        <Select
          allowClear
          style={{ width: 150 }}
          placeholder="全部状态"
          value={statusFilter || undefined}
          options={[{ label: '待送（已编号未送检）', value: 'pending' }, ...STATUS_FILTER_OPTIONS]}
          onChange={(value?: string) => updateParam('status', value ?? '')}
        />
        <span style={{ color: '#6b7a86' }}>收样单位</span>
        <Select
          allowClear
          showSearch
          style={{ width: 180 }}
          placeholder="全部单位"
          value={labFilter || undefined}
          options={labOptions.map((lab) => ({ label: lab, value: lab }))}
          onChange={(value?: string) => updateParam('lab', value ?? '')}
        />
        <Button onClick={resetFilters} disabled={filterActiveCount === 0}>
          重置
        </Button>
        <Tag color="blue">命中 {rows.length} 条</Tag>
        <Button icon={<DownloadOutlined />} onClick={handleExport}>
          导出筛选结果
        </Button>
      </Space>

      {pending.length === 0 && samples.length === 0 ? (
        <EmptyPanel description="暂无样品：请先在岩性编录中为深度区间填写样品号" actionText="登记送检" onAction={() => openCreate()} />
      ) : (
        <Card size="small">
          <Table
            rowKey="key"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1700 }}
            rowClassName={(row) => {
              if (row.pending) return 'sample-pending-row';
              return overdueOf(row.dispatch!) ? 'sample-overdue-row' : '';
            }}
            expandable={{
              showExpandColumn: true,
              rowExpandable: (row) => Boolean(row.dispatch),
              expandedRowRender: (row) => {
                const s = row.dispatch;
                if (!s) return null;
                return (
                  <Row gutter={16}>
                    <Col xs={24} md={11}>
                      <Descriptions size="small" column={1} bordered>
                        <Descriptions.Item label="样品编号">{s.sampleNo}</Descriptions.Item>
                        <Descriptions.Item label="钻孔 / 深度">
                          {holeNoOf(s.holeId)} · {s.fromDepth}~{s.toDepth}m（{s.lithology}）
                        </Descriptions.Item>
                        <Descriptions.Item label="类型 / 重量">
                          {s.sampleType} / {s.weight} kg
                        </Descriptions.Item>
                        <Descriptions.Item label="收样单位 / 送样人">
                          {s.lab} / {s.sender}
                        </Descriptions.Item>
                        <Descriptions.Item label="签收">{s.receivedAt ? `${dayjs(s.receivedAt).format('YYYY-MM-DD')} · ${s.receiver}` : '尚未签收'}</Descriptions.Item>
                        <Descriptions.Item label="退回">
                          {s.returnedAt ? (
                            <Text type="danger">
                              {dayjs(s.returnedAt).format('YYYY-MM-DD')} · {s.returnReason}
                            </Text>
                          ) : (
                            '无'
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="结果摘要">
                          {s.resultAt ? (
                            <span>
                              <Text strong>{dayjs(s.resultAt).format('YYYY-MM-DD')}</Text> {s.resultSummary}
                            </span>
                          ) : (
                            '结果未回录'
                          )}
                        </Descriptions.Item>
                        {s.remark ? <Descriptions.Item label="备注">{s.remark}</Descriptions.Item> : null}
                      </Descriptions>
                    </Col>
                    <Col xs={24} md={13}>
                      <Text type="secondary">流转记录</Text>
                      <Timeline
                        style={{ marginTop: 10 }}
                        items={[...s.events]
                          .sort((a, b) => a.at.localeCompare(b.at))
                          .map((evt) => ({
                            color: evt.type === 'returned' ? 'red' : evt.type === 'completed' ? 'green' : 'blue',
                            children: (
                              <div>
                                <Tag color={SAMPLE_STATUS_META[evt.type].color}>{SAMPLE_STATUS_META[evt.type].label}</Tag>
                                <Text type="secondary">
                                  {dayjs(evt.at).format('YYYY-MM-DD')} · {evt.operator}
                                </Text>
                                {evt.note ? <div style={{ color: '#4a5a66' }}>{evt.note}</div> : null}
                              </div>
                            ),
                          }))}
                      />
                    </Col>
                  </Row>
                );
              },
            }}
          />
        </Card>
      )}

      {/* 登记送检 */}
      <Modal
        open={mode === 'create'}
        title="登记送检"
        onCancel={closeModal}
        onOk={submitCreate}
        okText="保存"
        cancelText="取消"
        width={680}
        forceRender
      >
        <Form form={dispatchForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="holeId" label="钻孔" rules={[{ required: true, message: '请选择钻孔' }]}>
              <Select
                style={{ width: 230 }}
                options={holeOptions}
                onChange={(value: string) => {
                  setCreateHoleId(value);
                  const first = lithoOptionsForHole(value)[0]?.value;
                  dispatchForm.setFieldValue('lithoId', first);
                }}
              />
            </Form.Item>
            <Form.Item name="lithoId" label="岩性区间（已编样品号、尚未送检）" rules={[{ required: true, message: '请选择岩性区间' }]}>
              <Select
                style={{ width: 380 }}
                options={createHoleOptions}
                notFoundContent="该孔暂无可送检区间，请先在岩性编录填写样品号"
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="sampleType" label="样品类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select style={{ width: 150 }} options={SAMPLE_TYPES.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="weight" label="重量(kg)" rules={[{ required: true, message: '请输入重量' }]}>
              <InputNumber min={0.01} step={0.1} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="lab" label="收样单位" rules={[{ required: true, message: '请填写收样单位' }]}>
              <AutoComplete style={{ width: 200 }} options={labOptions.map((lab) => ({ value: lab }))} placeholder="选择或输入实验室" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="sentAt" label="送样日期" rules={[{ required: true, message: '请选择送样日期' }]}>
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="expectedAt" label="预计回件日期" rules={[{ required: true, message: '请选择预计回件日期' }]}>
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="sender" label="送样人" rules={[{ required: true, message: '请填写送样人' }]}>
              <Input style={{ width: 140 }} maxLength={16} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={100} placeholder="送样要求、分析项目等" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑送检登记 */}
      <Modal
        open={mode === 'edit'}
        title={active ? `编辑送检登记 · ${active.sampleNo}` : ''}
        onCancel={closeModal}
        onOk={submitEdit}
        okText="保存"
        cancelText="取消"
        width={620}
        forceRender
      >
        <Form form={dispatchForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="sampleType" label="样品类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select style={{ width: 160 }} options={SAMPLE_TYPES.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="weight" label="重量(kg)" rules={[{ required: true, message: '请输入重量' }]}>
              <InputNumber min={0.01} step={0.1} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="lab" label="收样单位" rules={[{ required: true, message: '请填写收样单位' }]}>
              <AutoComplete style={{ width: 200 }} options={labOptions.map((lab) => ({ value: lab }))} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="sentAt" label="送样日期" rules={[{ required: true, message: '请选择送样日期' }]}>
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="expectedAt" label="预计回件日期" rules={[{ required: true, message: '请选择预计回件日期' }]}>
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="sender" label="送样人" rules={[{ required: true, message: '请填写送样人' }]}>
              <Input style={{ width: 140 }} maxLength={16} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 登记实验室接收 */}
      <Modal open={mode === 'receive'} title={active ? `登记实验室接收 · ${active.sampleNo}` : ''} onCancel={closeModal} onOk={submitReceive} okText="确认接收" cancelText="取消" forceRender>
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message={`收样单位：${active?.lab}；送样日期 ${active ? dayjs(active.sentAt).format('YYYY-MM-DD') : ''}`} />
        <Form form={receiveForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="receivedAt" label="签收日期" rules={[{ required: true, message: '请选择签收日期' }]}>
              <DatePicker style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="receiver" label="签收人" rules={[{ required: true, message: '请填写实验室签收人' }]}>
              <Input style={{ width: 200 }} maxLength={16} placeholder="实验室签收人" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* 退回补采 */}
      <Modal open={mode === 'return'} title={active ? `退回补采 · ${active.sampleNo}` : ''} onCancel={closeModal} onOk={submitReturn} okText="确认退回" cancelText="取消" forceRender>
        <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="退回后状态变为「退回补采」，补采完成可重新送检；退回原因将写入流转记录。" />
        <Form form={returnForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="returnedAt" label="退回日期" rules={[{ required: true, message: '请选择退回日期' }]}>
              <DatePicker style={{ width: 170 }} />
            </Form.Item>
            <Form.Item name="operator" label="经办人" rules={[{ required: true, message: '请填写经办人' }]}>
              <Input style={{ width: 180 }} maxLength={16} placeholder="实验室/送样经办人" />
            </Form.Item>
          </Space>
          <Form.Item name="reason" label="退回原因" rules={[{ required: true, message: '退回补采必须填写原因' }]}>
            <Input.TextArea rows={3} maxLength={200} placeholder="如：样品破碎、重量不足、编号不清，需重新补采" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 补采后重新送检 */}
      <Modal open={mode === 'resend'} title={active ? `重新送检 · ${active?.sampleNo}` : ''} onCancel={closeModal} onOk={submitResend} okText="确认送检" cancelText="取消" width={620} forceRender>
        {active?.returnReason ? (
          <Alert style={{ marginBottom: 12 }} type="error" showIcon message={`上次退回原因：${active.returnReason}`} />
        ) : null}
        <Form form={resendForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="sentAt" label="送样日期" rules={[{ required: true, message: '请选择送样日期' }]}>
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="expectedAt" label="预计回件日期" rules={[{ required: true, message: '请选择预计回件日期' }]}>
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="weight" label="补采重量(kg)" rules={[{ required: true, message: '请输入重量' }]}>
              <InputNumber min={0.01} step={0.1} style={{ width: 140 }} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="lab" label="收样单位" rules={[{ required: true, message: '请填写收样单位' }]}>
              <AutoComplete style={{ width: 220 }} options={labOptions.map((lab) => ({ value: lab }))} />
            </Form.Item>
            <Form.Item name="sender" label="送样人" rules={[{ required: true, message: '请填写送样人' }]}>
              <Input style={{ width: 150 }} maxLength={16} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* 结果回录 */}
      <Modal open={mode === 'complete'} title={active ? `结果回录 · ${active?.sampleNo}` : ''} onCancel={closeModal} onOk={submitComplete} okText="回录并完成" cancelText="取消" forceRender>
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message={`${active?.lab} 已于 ${active?.receivedAt ? dayjs(active.receivedAt).format('YYYY-MM-DD') : '-'} 签收；完成时需补结果摘要。`} />
        <Form form={completeForm} layout="vertical">
          <Form.Item name="resultAt" label="结果日期" rules={[{ required: true, message: '请选择结果日期' }]}>
            <DatePicker style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="resultSummary" label="结果摘要" rules={[{ required: true, message: '完成时必须补录结果摘要' }]}>
            <Input.TextArea rows={4} maxLength={300} placeholder="如：Cu 0.78%、TFe 26.4%，达工业品位；附报告编号等" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** 同样品号跨多段区间时的深度提示 */
function MergedRangesTag({ ranges }: { ranges: Array<{ lithoId: string; from: number; to: number }> }) {
  const text = ranges.map((r) => `${r.from}~${r.to}`).join('、');
  return (
    <span>
      {text}
      <Tag color="orange" style={{ marginLeft: 6 }}>
        同样品号 {ranges.length} 段
      </Tag>
    </span>
  );
}
