import { useMemo } from 'react';
import { Alert, Button, Card, Col, Progress, Row, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { Link } from 'react-router-dom';
import StatBadge from '../components/common/StatBadge';
import RecoveryBadge from '../components/common/RecoveryBadge';
import FilterBar from '../components/common/FilterBar';
import { useHoleFilter } from '../hooks/useHoleFilter';
import { useHoleStore, holeProgressList } from '../stores/holeStore';
import { useRunStore, anomalyList } from '../stores/runStore';
import { useLithoStore } from '../stores/lithoStore';
import { useSubmissionStore } from '../stores/submissionStore';
import { RIG_NOS, SHIFTS, type HoleProgress } from '../types/drill-hole';
import type { RunAnomaly } from '../types/drill-run';
import { isAnomaly } from '../utils/recovery';
import { overdueOf, submissionSummaryByHole, type HoleSubmissionSummary } from '../utils/submissions';

const { Title, Paragraph, Text } = Typography;

/** 工作台：钻孔进度与采取率异常清单（低于 75% 标红） */
export default function HoleBoard() {
  const holes = useHoleStore((s) => s.holes);
  const runs = useRunStore((s) => s.runs);
  const lithos = useLithoStore((s) => s.lithos);
  const submissions = useSubmissionStore((s) => s.submissions);
  const filter = useHoleFilter();

  const visibleHoles = useMemo(() => filter.apply(holes), [holes, filter]);
  const progress = useMemo(() => holeProgressList(visibleHoles, runs), [visibleHoles, runs]);
  const visibleHoleIds = useMemo(() => new Set(visibleHoles.map((h) => h.id)), [visibleHoles]);

  const sampleSummary = useMemo(
    () => submissionSummaryByHole(visibleHoles, lithos, submissions),
    [visibleHoles, lithos, submissions],
  );
  const visibleSubmissions = useMemo(
    () => submissions.filter((sub) => visibleHoleIds.has(sub.holeId)),
    [submissions, visibleHoleIds],
  );
  const overdueReceive = visibleSubmissions.filter((sub) => overdueOf(sub)?.kind === 'overdueReceive');
  const overdueResult = visibleSubmissions.filter((sub) => overdueOf(sub)?.kind === 'overdueResult');
  const sampleTotals = useMemo(
    () =>
      sampleSummary.reduce(
        (acc, item) => ({
          pending: acc.pending + item.pending,
          sent: acc.sent + item.sent,
          received: acc.received + item.received,
          returned: acc.returned + item.returned,
          completed: acc.completed + item.completed,
        }),
        { pending: 0, sent: 0, received: 0, returned: 0, completed: 0 },
      ),
    [sampleSummary],
  );

  const holeNoOf = (holeId: string) => holes.find((h) => h.id === holeId)?.holeNo ?? '未知孔';
  const anomalies = useMemo<RunAnomaly[]>(
    () => anomalyList(runs.filter((run) => filter.matchRun(run, holes)), holeNoOf),
    [runs, holes, filter],
  );

  const inDrilling = progress.filter((item) => !item.finished).length;
  const finished = progress.filter((item) => item.finished).length;
  const supplement = progress.filter((item) => item.needSupplement);
  const avgRecovery = useMemo(() => {
    const totalFootage = runs.reduce((sum, run) => sum + run.footage, 0);
    const totalCore = runs.reduce((sum, run) => sum + run.coreLength, 0);
    return totalFootage > 0 ? Number(((totalCore / totalFootage) * 100).toFixed(1)) : 0;
  }, [runs]);

  const progressColumns: TableColumnsType<HoleProgress> = [
    { title: '孔号', width: 110, render: (_, row) => <Text strong>{row.hole.holeNo}</Text> },
    { title: '钻机', width: 90, render: (_, row) => row.hole.rigNo },
    { title: '班组', width: 80, render: (_, row) => row.hole.shift },
    { title: '设计孔深(m)', width: 110, align: 'right', render: (_, row) => row.hole.designDepth },
    { title: '已达深度(m)', width: 110, align: 'right', render: (_, row) => row.reachedDepth },
    {
      title: '设计达成率',
      width: 190,
      render: (_, row) => (
        <Progress percent={Math.min(100, Math.round(row.designRatio))} size="small" status={row.needSupplement ? 'exception' : undefined} />
      ),
    },
    {
      title: '状态',
      width: 150,
      render: (_, row) =>
        row.needSupplement ? (
          <Tag color="red">未达设计 · 待补勘</Tag>
        ) : row.finished ? (
          <Tag color="green">已终孔</Tag>
        ) : (
          <Tag color="blue">在钻</Tag>
        ),
    },
    {
      title: '操作',
      width: 110,
      render: (_, row) => (
        <Link to="/runs">
          <Button size="small" type="link">
            录回次
          </Button>
        </Link>
      ),
    },
  ];

  const anomalyColumns: TableColumnsType<RunAnomaly> = [
    { title: '孔号', width: 100, render: (_, row) => row.holeNo },
    { title: '回次号', width: 110, render: (_, row) => row.run.runNo },
    {
      title: '深度区间(m)',
      width: 130,
      render: (_, row) => `${row.run.fromDepth}~${row.run.toDepth}`,
    },
    { title: '进尺(m)', width: 90, align: 'right', render: (_, row) => row.run.footage },
    { title: '岩芯长度(m)', width: 110, align: 'right', render: (_, row) => row.run.coreLength },
    { title: '采取率', width: 130, render: (_, row) => <RecoveryBadge recovery={row.run.recovery} /> },
    { title: '处置建议', render: (_, row) => <Text type="danger">{row.advice}</Text> },
  ];

  const sampleColumns: TableColumnsType<HoleSubmissionSummary> = [
    { title: '孔号', width: 110, render: (_, row) => <Text strong>{row.hole.holeNo}</Text> },
    { title: '待送', width: 80, align: 'right', render: (_, row) => (row.pending ? <Tag color="orange">{row.pending}</Tag> : 0) },
    { title: '在检', width: 80, align: 'right', render: (_, row) => row.sent + row.received },
    {
      title: '其中待接收',
      width: 100,
      align: 'right',
      render: (_, row) => (row.sent ? <Tag color="blue">{row.sent}</Tag> : 0),
    },
    {
      title: '退回补采',
      width: 90,
      align: 'right',
      render: (_, row) => (row.returned ? <Tag color="red">{row.returned}</Tag> : 0),
    },
    { title: '已完成', width: 80, align: 'right', render: (_, row) => row.completed },
    {
      title: '逾期提醒',
      render: (_, row) =>
        row.overdue.length ? (
          <Space size={4} wrap>
            {row.overdue.map((sub) => {
              const mark = overdueOf(sub);
              return (
                <Tag key={sub.id} color="red">
                  {sub.sampleNo} · {mark?.kind === 'overdueReceive' ? '未接收' : '未出结果'} {mark?.days}天
                </Tag>
              );
            })}
          </Space>
        ) : (
          <Text type="secondary">正常</Text>
        ),
    },
    {
      title: '操作',
      width: 110,
      render: (_, row) => (
        <Link to={`/submissions?hole=${encodeURIComponent(row.hole.id)}`}>
          <Button size="small" type="link">
            去送检台账
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        矿区钻孔岩芯编目台
      </Title>
      <Paragraph type="secondary">
        登记钻孔台帐、回次进尺与采取率、岩芯箱箱位，并按深度区间编录岩性描述与样品。数据保存在浏览器本地（IndexedDB：
        gbdrillcore-db）。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="在钻钻孔" value={inDrilling} unit="个" status="warning" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="已终孔" value={finished} unit="个" status="success" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge
            label="未达设计待补勘"
            value={supplement.length}
            unit="个"
            status={supplement.length ? 'error' : 'success'}
            hint="终孔深度小于设计孔深"
          />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="有效采取率" value={avgRecovery} unit="%" status={avgRecovery >= 75 ? 'success' : 'error'} hint="岩芯长度合计 / 进尺合计" />
        </Col>
      </Row>

      {supplement.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          message={`未达设计孔深提醒：${supplement.length} 个钻孔终孔深度小于设计孔深，已计入待补勘`}
          description={
            <Space wrap>
              {supplement.map((item) => (
                <Tag key={item.hole.id} color="red">
                  {item.hole.holeNo}：终孔 {item.hole.finalDepth}m / 设计 {item.hole.designDepth}m（差 {(item.hole.designDepth - item.hole.finalDepth).toFixed(1)}m）
                </Tag>
              ))}
            </Space>
          }
        />
      ) : null}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="样品待送" value={sampleTotals.pending} unit="件" status={sampleTotals.pending ? 'warning' : 'success'} hint="岩性已编号但尚未登记送检" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge
            label="样品在检"
            value={sampleTotals.sent + sampleTotals.received}
            unit="件"
            status="default"
            hint={`待接收 ${sampleTotals.sent} 件 · 在检 ${sampleTotals.received} 件`}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="样品退回补采" value={sampleTotals.returned} unit="件" status={sampleTotals.returned ? 'error' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="样品已完成" value={sampleTotals.completed} unit="件" status="success" />
        </Col>
      </Row>

      {overdueReceive.length > 0 ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="error"
          showIcon
          message={`逾期未接收提醒：${overdueReceive.length} 件样品已过预计回件日期，实验室仍未确认接收`}
          description={
            <Space wrap>
              {overdueReceive.map((sub) => (
                <Tag key={sub.id} color="red">
                  {sub.sampleNo}（{holes.find((h) => h.id === sub.holeId)?.holeNo ?? '未知孔'}）逾期 {overdueOf(sub)?.days} 天
                </Tag>
              ))}
            </Space>
          }
        />
      ) : null}
      {overdueResult.length > 0 ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message={`逾期未出结果提醒：${overdueResult.length} 件样品已过预计回件日期，检测结果尚未回录`}
          description={
            <Space wrap>
              {overdueResult.map((sub) => (
                <Tag key={sub.id} color="orange">
                  {sub.sampleNo}（{holes.find((h) => h.id === sub.holeId)?.holeNo ?? '未知孔'}）逾期 {overdueOf(sub)?.days} 天
                </Tag>
              ))}
            </Space>
          }
        />
      ) : null}

      <FilterBar
        fields={[
          { key: 'rig', label: '钻机', options: RIG_NOS, width: 110 },
          { key: 'shift', label: '施工班组', options: SHIFTS, width: 110 },
        ]}
        keywordPlaceholder="搜索孔号 / 钻机 / 备注"
        resultCount={visibleHoles.length}
        totalCount={holes.length}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="钻孔进度" size="small" extra={<Link to="/holes"><Button size="small" type="primary">去钻孔台帐</Button></Link>}>
            <Table
              rowKey={(row) => row.hole.id}
              size="small"
              columns={progressColumns}
              dataSource={progress}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              scroll={{ x: 980 }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title="采取率异常清单（< 75% 标红）"
            size="small"
            extra={<Tag color={anomalies.length ? 'red' : 'green'}>{anomalies.length} 条</Tag>}
          >
            <Table
              rowKey={(row) => row.run.id}
              size="small"
              columns={anomalyColumns}
              dataSource={anomalies}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              scroll={{ x: 800 }}
              locale={{ emptyText: '暂无异常回次，采取率均不低于 75%' }}
            />
          </Card>
          <Card title="异常统计" size="small" style={{ marginTop: 16 }}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text>
                回次总数 <Text strong>{runs.length}</Text> 个，其中采取率异常{' '}
                <Text strong type="danger">
                  {runs.filter((run) => isAnomaly(run.recovery)).length}
                </Text>{' '}
                个
              </Text>
              <Text type="secondary">
                累计进尺 {runs.reduce((sum, run) => sum + run.footage, 0).toFixed(2)} m · 累计岩芯{' '}
                {runs.reduce((sum, run) => sum + run.coreLength, 0).toFixed(2)} m
              </Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card
            title="样品送检按孔汇总"
            size="small"
            extra={
              <Link to="/submissions">
                <Button size="small" type="primary">
                  去送检台账
                </Button>
              </Link>
            }
          >
            <Table
              rowKey={(row) => row.hole.id}
              size="small"
              columns={sampleColumns}
              dataSource={sampleSummary}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              scroll={{ x: 900 }}
              locale={{ emptyText: '暂无钻孔，请先在钻孔台帐建孔' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
