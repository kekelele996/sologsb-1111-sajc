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
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import StatBadge from '../components/common/StatBadge';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHoleStore } from '../stores/holeStore';
import { useLithoStore } from '../stores/lithoStore';
import {
  useSubmissionStore,
  type ReceiveInput,
  type ResendInput,
  type ResultInput,
  type ReturnInput,
  SubmissionStateError,
} from '../stores/submissionStore';
import {
  ASSAY_TYPES,
  EVENT_TEXT,
  SUBMISSION_ORGS,
  SUBMISSION_STATUS_META,
  type AssayType,
  type SampleSubmission,
  type SubmissionStatus,
} from '../types/sample-submission';
import type { LithoLog } from '../types/litho-log';
import { overdueList, overdueOf, pendingLithos } from '../utils/submissions';
import { downloadCsv } from '../utils/export';

const { Title, Paragraph, Text } = Typography;

interface CreateFormValues {
  lithoId: string;
  assayType: AssayType;
  weightKg: number;
  receiverOrg: string;
  sentAt: Dayjs;
  expectedAt: Dayjs;
  sender: string;
  remark?: string;
}

type ActionMode = 'receive' | 'return' | 'result' | 'resend';

interface ActionState {
  mode: ActionMode;
  record: SampleSubmission;
}

const ACTION_TITLE: Record<ActionMode, string> = {
  receive: '登记实验室接收',
  return: '退回补采',
  result: '结果回录',
  resend: '补采后重新送检',
};

const fmtDate = (iso?: string) => (iso ? dayjs(iso).format('YYYY-MM-DD') : '');

/** 送检台账：登记送检（选岩性区间）→ 接收 / 退回补采 → 结果回录，支持筛选导出归档 */
export default function SubmissionLedger() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const lithos = useLithoStore((s) => s.lithos);
  const submissions = useSubmissionStore((s) => s.submissions);
  const addSubmission = useSubmissionStore((s) => s.addSubmission);
  const markReceived = useSubmissionStore((s) => s.markReceived);
  const markReturned = useSubmissionStore((s) => s.markReturned);
  const markResent = useSubmissionStore((s) => s.markResent);
  const recordResult = useSubmissionStore((s) => s.recordResult);
  const removeSubmission = useSubmissionStore((s) => s.removeSubmission);

  const [params] = useSearchParams();
  const [fHole, setFHole] = useState<string>(params.get('hole') ?? '');
  const [fStatus, setFStatus] = useState<SubmissionStatus | ''>('');
  const [fType, setFType] = useState<AssayType | ''>('');
  const [fOrg, setFOrg] = useState('');
  const [keyword, setKeyword] = useState('');
  const [tab, setTab] = useState('ledger');

  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<ActionState | null>(null);
  const [detail, setDetail] = useState<SampleSubmission | null>(null);
  const [createForm] = Form.useForm<CreateFormValues>();
  const [actionForm] = Form.useForm();

  const holeById = useMemo(() => new Map(holes.map((h) => [h.id, h])), [holes]);
  const lithoById = useMemo(() => new Map(lithos.map((l) => [l.id, l])), [lithos]);
  const holeNo = (holeId: string) => holeById.get(holeId)?.holeNo ?? '未知孔';

  const pending = useMemo(() => pendingLithos(lithos, submissions), [lithos, submissions]);
  const overdues = useMemo(() => overdueList(submissions), [submissions]);

  const orgOptions = useMemo(() => Array.from(new Set(submissions.map((s) => s.receiverOrg))), [submissions]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return submissions
      .filter((sub) => {
        if (fHole && sub.holeId !== fHole) return false;
        if (fStatus && sub.status !== fStatus) return false;
        if (fType && sub.assayType !== fType) return false;
        if (fOrg && sub.receiverOrg !== fOrg) return false;
        if (kw) {
          const haystack = `${sub.sampleNo} ${sub.receiverOrg} ${sub.resultSummary ?? ''} ${sub.returnReason ?? ''} ${holeNo(
            sub.holeId,
          )}`.toLowerCase();
          if (!haystack.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  }, [submissions, fHole, fStatus, fType, fOrg, keyword, holes]);

  const filteredPending = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return pending.filter((log) => {
      if (fHole && log.holeId !== fHole) return false;
      if (kw && !`${log.sampleNo} ${log.lithology} ${log.logger} ${holeNo(log.holeId)}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [pending, fHole, keyword, holes]);

  const count = (status: SubmissionStatus) => submissions.filter((s) => s.status === status).length;
  const inTesting = count('sent') + count('received');

  const openCreate = (preselectLithoId?: string) => {
    if (pending.length === 0 && !preselectLithoId) {
      message.info('暂无可送检样品：请先在岩性编录中为区间编号，且该编号未登记过送检');
      return;
    }
    createForm.resetFields();
    const preset = preselectLithoId && pending.some((l) => l.id === preselectLithoId) ? preselectLithoId : pending[0]?.id;
    createForm.setFieldsValue({
      lithoId: preset,
      assayType: '基本分析(化学样)',
      sentAt: dayjs(),
      expectedAt: dayjs().add(15, 'day'),
      sender: '陈立',
    } as Partial<CreateFormValues>);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    const litho = lithoById.get(values.lithoId);
    if (!litho) {
      message.error('请选择已编号的岩性区间');
      return;
    }
    if (values.expectedAt.isBefore(values.sentAt, 'day')) {
      message.error('预计回件日期不能早于送检日期');
      return;
    }
    try {
      const sub = await addSubmission(
        {
          lithoId: litho.id,
          assayType: values.assayType,
          weightKg: Number(values.weightKg) || 0,
          receiverOrg: values.receiverOrg,
          expectedAt: values.expectedAt.toISOString(),
          sentAt: values.sentAt.toISOString(),
          sender: values.sender,
          remark: values.remark,
        },
        { id: litho.id, holeId: litho.holeId, sampleNo: litho.sampleNo, fromDepth: litho.fromDepth, toDepth: litho.toDepth },
      );
      message.success(`样品 ${sub.sampleNo} 已登记送检至 ${sub.receiverOrg}`);
      setCreateOpen(false);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const openAction = (mode: ActionMode, record: SampleSubmission) => {
    actionForm.resetFields();
    const base = { at: dayjs(), operator: '陈立' };
    if (mode === 'receive') actionForm.setFieldsValue({ ...base, receivedBy: '王工' });
    if (mode === 'return') actionForm.setFieldsValue(base);
    if (mode === 'result') actionForm.setFieldsValue(base);
    if (mode === 'resend') {
      actionForm.setFieldsValue({
        sentAt: dayjs(),
        expectedAt: dayjs(record.expectedAt).isAfter(dayjs()) ? dayjs(record.expectedAt) : dayjs().add(15, 'day'),
        receiverOrg: record.receiverOrg,
        weightKg: record.weightKg,
        sender: record.sender,
      });
    }
    setAction({ mode, record });
  };

  const submitAction = async () => {
    if (!action) return;
    const { mode, record } = action;
    try {
      if (mode === 'receive') {
        const v = await actionForm.validateFields();
        const payload: ReceiveInput = { receivedAt: v.at.toISOString(), receivedBy: v.receivedBy, note: v.note };
        await markReceived(record.id, payload);
        message.success(`样品 ${record.sampleNo} 已登记实验室接收`);
      } else if (mode === 'return') {
        const v = await actionForm.validateFields();
        const payload: ReturnInput = { returnedAt: v.at.toISOString(), returnReason: v.reason, operator: v.operator };
        await markReturned(record.id, payload);
        message.warning(`样品 ${record.sampleNo} 已退回补采`);
      } else if (mode === 'result') {
        const v = await actionForm.validateFields();
        const payload: ResultInput = { resultAt: v.at.toISOString(), resultSummary: v.summary, operator: v.operator };
        await recordResult(record.id, payload);
        message.success(`样品 ${record.sampleNo} 结果已回录，台账完成`);
      } else {
        const v = await actionForm.validateFields();
        if (v.expectedAt.isBefore(v.sentAt, 'day')) {
          message.error('预计回件日期不能早于重新送检日期');
          return;
        }
        const payload: ResendInput = {
          sentAt: v.sentAt.toISOString(),
          expectedAt: v.expectedAt.toISOString(),
          receiverOrg: v.receiverOrg,
          weightKg: Number(v.weightKg) || 0,
          sender: v.sender,
          note: v.note,
        };
        await markResent(record.id, payload);
        message.success(`样品 ${record.sampleNo} 已补采并重新送检`);
      }
      setAction(null);
    } catch (error) {
      if (error instanceof SubmissionStateError) message.error(error.message);
    }
  };

  const lithoGroupOptions = useMemo(
    () =>
      holes
        .map((hole) => ({
          label: hole.holeNo,
          options: pending
            .filter((l) => l.holeId === hole.id)
            .map((l) => ({ label: `${l.sampleNo} · ${l.fromDepth}~${l.toDepth}m · ${l.lithology}`, value: l.id })),
        }))
        .filter((group) => group.options.length > 0),
    [holes, pending],
  );

  const watchLithoId = Form.useWatch('lithoId', createForm);
  const watchLitho: LithoLog | undefined = lithoById.get(watchLithoId);

  const columns: TableColumnsType<SampleSubmission> = [
    { title: '样品号', width: 130, fixed: 'left', render: (_, row) => <Text strong>{row.sampleNo}</Text> },
    { title: '孔号', width: 95, render: (_, row) => holeNo(row.holeId) },
    { title: '深度区间(m)', width: 120, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    { title: '类型', dataIndex: 'assayType', width: 140 },
    { title: '重量(kg)', dataIndex: 'weightKg', width: 90, align: 'right' },
    { title: '收样单位', dataIndex: 'receiverOrg', width: 140, ellipsis: true },
    { title: '送检日期', dataIndex: 'sentAt', width: 105, render: (v: string) => fmtDate(v) },
    {
      title: '预计回件',
      dataIndex: 'expectedAt',
      width: 120,
      render: (_, row) => {
        const mark = overdueOf(row);
        return (
          <Space size={4} direction="vertical" style={{ lineHeight: 1.2 }}>
            <span>{fmtDate(row.expectedAt)}</span>
            {mark ? <Tag color="red" style={{ marginInlineEnd: 0 }}>逾期 {mark.days} 天</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 95,
      render: (status: SubmissionStatus) => <Tag color={SUBMISSION_STATUS_META[status].color}>{SUBMISSION_STATUS_META[status].label}</Tag>,
    },
    { title: '接收日期', dataIndex: 'receivedAt', width: 105, render: (v?: string) => fmtDate(v) || '-' },
    { title: '退回原因', dataIndex: 'returnReason', width: 180, ellipsis: true, render: (v?: string) => v ?? '-' },
    { title: '结果摘要', dataIndex: 'resultSummary', width: 200, ellipsis: true, render: (v?: string) => v ?? '-' },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap>
          <Button size="small" type="link" onClick={() => setDetail(record)}>
            详情
          </Button>
          {record.status === 'sent' ? (
            <Button size="small" type="link" onClick={() => openAction('receive', record)}>
              接收
            </Button>
          ) : null}
          {record.status === 'received' ? (
            <Button size="small" type="link" onClick={() => openAction('result', record)}>
              回录结果
            </Button>
          ) : null}
          {record.status === 'returned' ? (
            <Button size="small" type="link" onClick={() => openAction('resend', record)}>
              重新送检
            </Button>
          ) : null}
          {(record.status === 'sent' || record.status === 'received') && (
            <Button size="small" type="link" danger onClick={() => openAction('return', record)}>
              退回
            </Button>
          )}
          <Popconfirm title={`确认删除台账记录 ${record.sampleNo}？`} onConfirm={() => removeSubmission(record.id).then(() => message.success('已删除'))}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pendingColumns: TableColumnsType<LithoLog> = [
    { title: '样品号', dataIndex: 'sampleNo', width: 140, render: (v: string) => <Text strong>{v}</Text> },
    { title: '孔号', width: 100, render: (_, row) => holeNo(row.holeId) },
    { title: '深度区间(m)', width: 130, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    { title: '岩性', dataIndex: 'lithology', width: 140, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: '矿化', dataIndex: 'mineralization', width: 100 },
    { title: '编录人', dataIndex: 'logger', width: 90 },
    {
      title: '操作',
      width: 130,
      render: (_, record) => (
        <Button size="small" type="primary" onClick={() => openCreate(record.id)}>
          登记送检
        </Button>
      ),
    },
  ];

  const overdueTag = (sub: SampleSubmission, prefix: string) => {
    const mark = overdueOf(sub);
    return (
      <Tag key={sub.id} color="red">
        {sub.sampleNo}（{holeNo(sub.holeId)}）{prefix}
        {mark ? ` ${mark.days} 天` : ''}
      </Tag>
    );
  };

  const handleExport = () => {
    const rows: Record<string, unknown>[] = filtered.map((sub) => ({
      sampleNo: sub.sampleNo,
      holeNo: holeNo(sub.holeId),
      range: `${sub.fromDepth}~${sub.toDepth}`,
      assayType: sub.assayType,
      weightKg: sub.weightKg,
      receiverOrg: sub.receiverOrg,
      status: SUBMISSION_STATUS_META[sub.status].label,
      sentAt: fmtDate(sub.sentAt),
      expectedAt: fmtDate(sub.expectedAt),
      receivedAt: fmtDate(sub.receivedAt),
      returnedAt: fmtDate(sub.returnedAt),
      returnReason: sub.returnReason ?? '',
      resultAt: fmtDate(sub.resultAt),
      resultSummary: sub.resultSummary ?? '',
      sender: sub.sender,
    }));
    downloadCsv(
      `sample-submissions-${dayjs().format('YYYYMMDD')}.csv`,
      rows,
      [
        { key: 'sampleNo', title: '样品号' },
        { key: 'holeNo', title: '孔号' },
        { key: 'range', title: '深度区间(m)' },
        { key: 'assayType', title: '类型' },
        { key: 'weightKg', title: '重量(kg)' },
        { key: 'receiverOrg', title: '收样单位' },
        { key: 'status', title: '状态' },
        { key: 'sentAt', title: '送检日期' },
        { key: 'expectedAt', title: '预计回件' },
        { key: 'receivedAt', title: '接收日期' },
        { key: 'returnedAt', title: '退回日期' },
        { key: 'returnReason', title: '退回原因' },
        { key: 'resultAt', title: '结果日期' },
        { key: 'resultSummary', title: '结果摘要' },
        { key: 'sender', title: '送样人' },
      ],
    );
    message.success(`已导出当前筛选结果 ${rows.length} 条（CSV，归档用）`);
  };

  const filterBar = (
    <Space wrap size={[8, 8]} style={{ marginBottom: 12 }} align="center">
      <Input.Search allowClear style={{ width: 230 }} placeholder="搜索样品号 / 单位 / 结果 / 孔号" onSearch={setKeyword} />
      <span>
        <span style={{ color: '#6b7a86', marginRight: 6 }}>钻孔</span>
        <Select
          allowClear
          style={{ width: 150 }}
          placeholder="全部"
          value={fHole || undefined}
          onChange={(v?: string) => setFHole(v ?? '')}
          options={holes.map((h) => ({ label: h.holeNo, value: h.id }))}
        />
      </span>
      <Select
        allowClear
        style={{ width: 130 }}
        placeholder="状态全部"
        value={fStatus || undefined}
        onChange={(v?: SubmissionStatus) => setFStatus(v ?? '')}
        options={(Object.keys(SUBMISSION_STATUS_META) as SubmissionStatus[]).map((s) => ({
          label: SUBMISSION_STATUS_META[s].label,
          value: s,
        }))}
      />
      <Select
        allowClear
        style={{ width: 160 }}
        placeholder="类型全部"
        value={fType || undefined}
        onChange={(v?: AssayType) => setFType(v ?? '')}
        options={ASSAY_TYPES.map((v) => ({ label: v, value: v }))}
      />
      <Select
        allowClear
        showSearch
        style={{ width: 170 }}
        placeholder="收样单位全部"
        value={fOrg || undefined}
        onChange={(v?: string) => setFOrg(v ?? '')}
        options={orgOptions.map((v) => ({ label: v, value: v }))}
      />
      <Tag color="blue">
        命中 {filtered.length} / {submissions.length}
      </Tag>
    </Space>
  );

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        样品送检台账
      </Title>
      <Paragraph type="secondary">
        送检时选择岩性编录中已编号的岩性区间，登记样品类型、重量、收样单位与预计回件日期；随后登记实验室接收、退回补采（必填原因）与结果回录（完成补结果摘要）。同一编号不能重复送检。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="待送（已编号未送检）" value={pending.length} unit="件" status={pending.length ? 'warning' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge
            label="在检（待接收/在检）"
            value={inTesting}
            unit="件"
            status="default"
            hint={`待接收 ${count('sent')} 件 · 在检 ${count('received')} 件`}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="退回补采" value={count('returned')} unit="件" status={count('returned') ? 'error' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="已完成" value={count('completed')} unit="件" status="success" />
        </Col>
      </Row>

      {overdues.receive.length > 0 ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="error"
          showIcon
          message={`逾期未接收提醒：${overdues.receive.length} 件样品已过预计回件日期，实验室仍未确认接收`}
          description={<Space wrap>{overdues.receive.map((sub) => overdueTag(sub, '逾期未接收'))}</Space>}
        />
      ) : null}
      {overdues.result.length > 0 ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message={`逾期未出结果提醒：${overdues.result.length} 件样品已过预计回件日期，检测结果尚未回录`}
          description={<Space wrap>{overdues.result.map((sub) => overdueTag(sub, '逾期未出结果'))}</Space>}
        />
      ) : null}

      <Card size="small">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'ledger',
              label: `送检台账（${submissions.length}）`,
              children: (
                <>
                  <Space style={{ marginBottom: 12, justifyContent: 'space-between', width: '100%' }} wrap>
                    {filterBar}
                    <Space>
                      <Button type="primary" onClick={() => openCreate()} disabled={pending.length === 0}>
                        送检登记
                      </Button>
                      <Button icon={<ExportOutlined />} onClick={handleExport} disabled={filtered.length === 0}>
                        导出筛选结果
                      </Button>
                    </Space>
                  </Space>
                  <Table
                    rowKey="id"
                    size="small"
                    columns={columns}
                    dataSource={filtered}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 1750 }}
                    rowClassName={(row) => (overdueOf(row) ? 'overdue-row' : '')}
                    locale={{ emptyText: '暂无送检记录，可在「待送样品」页签登记送检' }}
                  />
                </>
              ),
            },
            {
              key: 'pending',
              label: `待送样品（${pending.length}）`,
              children: (
                <>
                  <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
                    <Space wrap size={[8, 8]}>
                      <Input.Search allowClear style={{ width: 230 }} placeholder="搜索样品号 / 岩性 / 孔号" onSearch={setKeyword} />
                      <span>
                        <span style={{ color: '#6b7a86', marginRight: 6 }}>钻孔</span>
                        <Select
                          allowClear
                          style={{ width: 150 }}
                          placeholder="全部"
                          value={fHole || undefined}
                          onChange={(v?: string) => setFHole(v ?? '')}
                          options={holes.map((h) => ({ label: h.holeNo, value: h.id }))}
                        />
                      </span>
                      <Tag color="blue">
                        命中 {filteredPending.length} / {pending.length}
                      </Tag>
                    </Space>
                    <Button type="primary" onClick={() => openCreate()} disabled={pending.length === 0}>
                      送检登记
                    </Button>
                  </Space>
                  {filteredPending.length === 0 ? (
                    <EmptyPanel description="暂无待送样品：岩性编录中已编号且未送检的区间会列在这里" />
                  ) : (
                    <Table
                      rowKey="id"
                      size="small"
                      columns={pendingColumns}
                      dataSource={filteredPending}
                      pagination={{ pageSize: 10 }}
                      scroll={{ x: 900 }}
                    />
                  )}
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* 送检登记弹窗 */}
      <Modal
        open={createOpen}
        title="送检登记"
        width={640}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        okText="登记送检"
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="lithoId" label="岩性区间（取自岩性编录的已编号样品）" rules={[{ required: true, message: '请选择岩性区间' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={lithoGroupOptions}
              placeholder="按孔分组选择已编号且未送检的岩性区间"
            />
          </Form.Item>
          {watchLitho ? (
            <Alert
              style={{ marginBottom: 12 }}
              type="info"
              showIcon
              message={`样品号 ${watchLitho.sampleNo} · ${holeNo(watchLitho.holeId)} · ${watchLitho.fromDepth}~${watchLitho.toDepth}m · ${watchLitho.lithology}`}
              description="样品号取自岩性编录，同一编号不能重复送检登记。"
            />
          ) : null}
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="assayType" label="样品类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select style={{ width: 190 }} options={ASSAY_TYPES.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="weightKg" label="样品重量(kg)" rules={[{ required: true, message: '请输入重量' }]}>
              <InputNumber min={0} step={0.1} style={{ width: 150 }} placeholder="如：3.5" />
            </Form.Item>
          </Space>
          <Form.Item name="receiverOrg" label="收样单位" rules={[{ required: true, message: '请填写收样单位' }]}>
            <AutoComplete
              style={{ width: 320 }}
              options={SUBMISSION_ORGS.map((v) => ({ label: v, value: v }))}
              filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="选择或填写实验室 / 检测单位"
            />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="sentAt" label="送检日期" rules={[{ required: true, message: '请选择送检日期' }]}>
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="expectedAt" label="预计回件日期" rules={[{ required: true, message: '请选择预计回件日期' }]}>
              <DatePicker style={{ width: 170 }} />
            </Form.Item>
            <Form.Item name="sender" label="送样人" rules={[{ required: true, message: '请填写送样人' }]}>
              <Input style={{ width: 130 }} maxLength={16} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={120} placeholder="运输要求、样品批次等" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 接收 / 退回 / 结果回录 / 重新送检 弹窗 */}
      <Modal
        open={!!action}
        title={action ? `${ACTION_TITLE[action.mode]} · ${action.record.sampleNo}` : ''}
        width={560}
        onCancel={() => setAction(null)}
        onOk={submitAction}
        okText="保存"
        cancelText="取消"
      >
        {action ? (
          <Form form={actionForm} layout="vertical">
            {action.mode === 'receive' ? (
              <>
                <Form.Item name="at" label="实验室接收日期" rules={[{ required: true, message: '请选择接收日期' }]}>
                  <DatePicker style={{ width: 200 }} />
                </Form.Item>
                <Form.Item name="receivedBy" label="收样人" rules={[{ required: true, message: '请填写收样人' }]}>
                  <Input style={{ width: 220 }} maxLength={16} placeholder="实验室签收人" />
                </Form.Item>
                <Form.Item name="note" label="接收备注">
                  <Input.TextArea rows={2} maxLength={120} placeholder="样品外观、封样情况等" />
                </Form.Item>
              </>
            ) : null}

            {action.mode === 'return' ? (
              <>
                <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="退回后样品进入「退回补采」，需在原孔对应深度重新采样后再「重新送检」" />
                <Form.Item name="at" label="退回日期" rules={[{ required: true, message: '请选择退回日期' }]}>
                  <DatePicker style={{ width: 200 }} />
                </Form.Item>
                <Form.Item name="reason" label="退回原因" rules={[{ required: true, message: '退回必须填写原因' }]}>
                  <Input.TextArea rows={3} maxLength={200} placeholder="如：样品重量不足 / 编号不清 / 包装破损污染 / 岩性不符需重新劈取" />
                </Form.Item>
                <Form.Item name="operator" label="登记人" rules={[{ required: true, message: '请填写登记人' }]}>
                  <Input style={{ width: 200 }} maxLength={16} />
                </Form.Item>
              </>
            ) : null}

            {action.mode === 'result' ? (
              <>
                <Form.Item name="at" label="结果日期" rules={[{ required: true, message: '请选择结果日期' }]}>
                  <DatePicker style={{ width: 200 }} />
                </Form.Item>
                <Form.Item name="summary" label="结果摘要" rules={[{ required: true, message: '完成时必须补结果摘要' }]}>
                  <Input.TextArea rows={4} maxLength={300} placeholder="如：Cu 0.42%、TFe 32.6%，达工业品位" />
                </Form.Item>
                <Form.Item name="operator" label="回录人" rules={[{ required: true, message: '请填写回录人' }]}>
                  <Input style={{ width: 200 }} maxLength={16} />
                </Form.Item>
              </>
            ) : null}

            {action.mode === 'resend' ? (
              <>
                <Alert style={{ marginBottom: 12 }} type="info" showIcon message={`上次退回原因：${action.record.returnReason ?? '-'}`} />
                <Space size={12} style={{ display: 'flex' }} align="start">
                  <Form.Item name="sentAt" label="重新送检日期" rules={[{ required: true, message: '请选择送检日期' }]}>
                    <DatePicker style={{ width: 170 }} />
                  </Form.Item>
                  <Form.Item name="expectedAt" label="预计回件日期" rules={[{ required: true, message: '请选择预计回件日期' }]}>
                    <DatePicker style={{ width: 170 }} />
                  </Form.Item>
                </Space>
                <Form.Item name="receiverOrg" label="收样单位" rules={[{ required: true, message: '请填写收样单位' }]}>
                  <AutoComplete
                    style={{ width: 320 }}
                    options={SUBMISSION_ORGS.map((v) => ({ label: v, value: v }))}
                    filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                  />
                </Form.Item>
                <Space size={12} style={{ display: 'flex' }} align="start">
                  <Form.Item name="weightKg" label="补采样品重量(kg)" rules={[{ required: true, message: '请输入重量' }]}>
                    <InputNumber min={0} step={0.1} style={{ width: 170 }} />
                  </Form.Item>
                  <Form.Item name="sender" label="送样人" rules={[{ required: true, message: '请填写送样人' }]}>
                    <Input style={{ width: 150 }} maxLength={16} />
                  </Form.Item>
                </Space>
                <Form.Item name="note" label="备注">
                  <Input.TextArea rows={2} maxLength={120} placeholder="补采深度、处置说明等" />
                </Form.Item>
              </>
            ) : null}
          </Form>
        ) : null}
      </Modal>

      {/* 台账详情 */}
      <Modal open={!!detail} title={detail ? `台账详情 · ${detail.sampleNo}` : ''} width={640} footer={null} onCancel={() => setDetail(null)}>
        {detail ? (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="样品号" span={2}>
                <Text strong>{detail.sampleNo}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="孔号">{holeNo(detail.holeId)}</Descriptions.Item>
              <Descriptions.Item label="深度区间(m)">{`${detail.fromDepth}~${detail.toDepth}`}</Descriptions.Item>
              <Descriptions.Item label="类型">{detail.assayType}</Descriptions.Item>
              <Descriptions.Item label="重量(kg)">{detail.weightKg}</Descriptions.Item>
              <Descriptions.Item label="收样单位" span={2}>
                {detail.receiverOrg}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={SUBMISSION_STATUS_META[detail.status].color}>{SUBMISSION_STATUS_META[detail.status].label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="预计回件">
                {fmtDate(detail.expectedAt)}
                {overdueOf(detail) ? <Tag color="red">逾期 {overdueOf(detail)?.days} 天</Tag> : null}
              </Descriptions.Item>
              <Descriptions.Item label="送检日期">{fmtDate(detail.sentAt)}</Descriptions.Item>
              <Descriptions.Item label="送样人">{detail.sender}</Descriptions.Item>
              <Descriptions.Item label="接收日期">{fmtDate(detail.receivedAt) || '-'}</Descriptions.Item>
              <Descriptions.Item label="收样人">{detail.receivedBy ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="退回日期">{fmtDate(detail.returnedAt) || '-'}</Descriptions.Item>
              <Descriptions.Item label="退回原因">{detail.returnReason ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="结果日期">{fmtDate(detail.resultAt) || '-'}</Descriptions.Item>
              <Descriptions.Item label="结果摘要" span={2}>
                {detail.resultSummary ?? '-'}
              </Descriptions.Item>
              {detail.remark ? (
                <Descriptions.Item label="备注" span={2}>
                  {detail.remark}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
            <Title level={5} style={{ marginTop: 20 }}>
              处理流水
            </Title>
            <Timeline
              items={[...detail.events]
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((e) => ({
                  color: e.type === 'returned' ? 'red' : e.type === 'received' || e.type === 'completed' ? 'green' : 'blue',
                  children: (
                    <Space direction="vertical" size={0}>
                      <Text strong>{EVENT_TEXT[e.type]}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(e.at).format('YYYY-MM-DD HH:mm')} · {e.operator}
                      </Text>
                      {e.note ? <Text type={e.type === 'returned' ? 'danger' : undefined}>{e.note}</Text> : null}
                    </Space>
                  ),
                }))}
            />
          </>
        ) : null}
      </Modal>
    </div>
  );
}
