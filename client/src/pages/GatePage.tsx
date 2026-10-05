import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtTime } from '../api';
import { useStatus } from '../hooks';
import type { PassEventRow, ScanEventInput, ScanResult } from '../types';

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const RESULT_TEXT: Record<string, string> = {
  ACCEPTED: '已登记',
  REJECTED: '已拒绝',
  DUPLICATE: '重复事件（已去重）',
  INVALID: '数据无效',
};
const REASON_TEXT: Record<string, string> = {
  NO_PERMISSION: '不在本航次生效名单上，无通行权限',
  MEMBER_SUSPENDED: '证件遗失，通行已暂停',
  VOYAGE_CLOSED: '航次已离港',
  VOYAGE_NOT_FOUND: '航次不存在',
};

function ResultLine({ r }: { r: ScanResult }) {
  const cls = r.result === 'ACCEPTED' ? 'ok' : r.result === 'DUPLICATE' ? 'warn' : 'bad';
  return (
    <div className={`scan-result ${cls}`}>
      <code>{r.eventNo.slice(0, 8)}…</code> {RESULT_TEXT[r.result] ?? r.result}
      {r.result === 'DUPLICATE' && r.originalResult ? `（首次结果：${RESULT_TEXT[r.originalResult] ?? r.originalResult}）` : ''}
      {r.reason ? ` — ${REASON_TEXT[r.reason] ?? r.reason}` : ''}
    </div>
  );
}

export default function GatePage() {
  const { id = '' } = useParams();
  const { data, reload } = useStatus(id);
  const queueKey = `gateQueue:${id}`;

  const [docNo, setDocNo] = useState('');
  const [direction, setDirection] = useState<'ASHORE' | 'RETURN'>('ASHORE');
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<ScanEventInput[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(queueKey) ?? '[]');
    } catch {
      return [];
    }
  });
  const [results, setResults] = useState<ScanResult[]>([]);
  const [lastEvent, setLastEvent] = useState<ScanEventInput | null>(null);
  const [recent, setRecent] = useState<PassEventRow[]>([]);

  const members = useMemo(() => data?.members ?? [], [data]);
  useEffect(() => {
    if (!docNo && members.length > 0) setDocNo(members[0].docNo);
  }, [members, docNo]);

  const saveQueue = (q: ScanEventInput[]) => {
    setQueue(q);
    localStorage.setItem(queueKey, JSON.stringify(q));
  };

  const loadRecent = () => api.getEvents(id).then((rows) => setRecent(rows.slice(0, 10))).catch(() => {});

  useEffect(() => {
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const afterChange = () => {
    reload();
    loadRecent();
  };

  const submit = async () => {
    if (!docNo) return;
    const event: ScanEventInput = {
      eventNo: crypto.randomUUID(),
      voyageId: id,
      docNo,
      direction,
      occurredAt: new Date(occurredAt).toISOString(),
    };
    setLastEvent(event);
    if (offline) {
      saveQueue([...queue, event]);
      setResults([{ eventNo: event.eventNo, result: 'INVALID', reason: '离线模式：已暂存本地，待补传' }]);
      return;
    }
    try {
      const r = await api.scan(event);
      setResults([r]);
      afterChange();
    } catch (e: any) {
      setResults([{ eventNo: event.eventNo, result: 'INVALID', reason: e.message }]);
    }
  };

  const syncQueue = async () => {
    if (queue.length === 0) return;
    try {
      const res = await api.scanBatch(queue.map((e) => ({ ...e, source: 'OFFLINE_SYNC' })));
      setResults(res.results);
      saveQueue([]);
      afterChange();
    } catch (e: any) {
      alert(`补传失败：${e.message}`);
    }
  };

  const resendLast = async () => {
    if (!lastEvent) return;
    try {
      const r = await api.scan(lastEvent);
      setResults((prev) => [r, ...prev].slice(0, 8));
      afterChange();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div>
      <section className="card">
        <h2>船梯口扫码登记（本地模拟）</h2>
        <div className="form-grid">
          <label>
            船员（生效名单）
            <select value={docNo} onChange={(e) => setDocNo(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.docNo}>
                  {m.name}（尾号 {m.docTail}）
                </option>
              ))}
            </select>
          </label>
          <label>
            方向
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'ASHORE' | 'RETURN')}>
              <option value="ASHORE">登岸</option>
              <option value="RETURN">返船</option>
            </select>
          </label>
          <label>
            事件发生时间
            <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
            离线模式（事件暂存本地，之后补传）
          </label>
        </div>
        <div className="btn-row">
          <button onClick={submit} disabled={!docNo || members.length === 0}>
            {offline ? '暂存离线事件' : '扫码登记'}
          </button>
          <button onClick={resendLast} disabled={!lastEvent} className="btn-secondary">
            重发上一事件（验证去重）
          </button>
          <button onClick={syncQueue} disabled={queue.length === 0} className="btn-secondary">
            补传离线事件（{queue.length}）
          </button>
        </div>
        {members.length === 0 && <p className="muted">尚无生效名单，请先在「代理名单」页提交。</p>}
        {results.length > 0 && (
          <div className="results">
            {results.map((r, i) => (
              <ResultLine key={`${r.eventNo}-${i}`} r={r} />
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>最近通行记录</h2>
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>证件尾号</th>
              <th>方向</th>
              <th>发生时间</th>
              <th>来源</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((e) => (
              <tr key={e.id}>
                <td>{e.memberName ?? '—'}</td>
                <td>{e.docTail}</td>
                <td>{e.direction === 'RETURN' ? '返船' : '登岸'}</td>
                <td>{fmtTime(e.occurredAt)}</td>
                <td>{e.source === 'OFFLINE_SYNC' ? '离线补传' : '闸口'}</td>
                <td>{RESULT_TEXT[e.result] ?? e.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
