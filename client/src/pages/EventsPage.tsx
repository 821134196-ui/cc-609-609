import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtTime } from '../api';
import type { PassEventRow } from '../types';

const RESULT_TEXT: Record<string, string> = {
  ACCEPTED: '已登记',
  REJECTED: '已拒绝',
};
const REASON_TEXT: Record<string, string> = {
  NO_PERMISSION: '无通行权限',
  MEMBER_SUSPENDED: '已暂停通行',
  VOYAGE_CLOSED: '航次已离港',
  VOYAGE_NOT_FOUND: '航次不存在',
};

export default function EventsPage() {
  const { id = '' } = useParams();
  const [events, setEvents] = useState<PassEventRow[]>([]);
  const [direction, setDirection] = useState('');
  const [result, setResult] = useState('');
  const [docNo, setDocNo] = useState('');

  const load = useCallback(async () => {
    const rows = await api.getEvents(id, {
      direction: direction || undefined,
      result: result || undefined,
      docNo: docNo.trim() || undefined,
    });
    setEvents(rows);
  }, [id, direction, result, docNo]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <section className="card">
      <h2>通行记录查询</h2>
      <div className="inline-form">
        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">全部方向</option>
          <option value="ASHORE">登岸</option>
          <option value="RETURN">返船</option>
        </select>
        <select value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">全部结果</option>
          <option value="ACCEPTED">已登记</option>
          <option value="REJECTED">已拒绝</option>
        </select>
        <input placeholder="按证件号精确查询" value={docNo} onChange={(e) => setDocNo(e.target.value)} />
        <button onClick={() => load()}>查询</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>事件号</th>
            <th>姓名</th>
            <th>证件尾号</th>
            <th>方向</th>
            <th>发生时间</th>
            <th>接收时间</th>
            <th>来源</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>
                <code>{e.eventNo.slice(0, 8)}</code>
              </td>
              <td>{e.memberName ?? '—'}</td>
              <td>{e.docTail}</td>
              <td>{e.direction === 'RETURN' ? '返船' : '登岸'}</td>
              <td>{fmtTime(e.occurredAt)}</td>
              <td>{fmtTime(e.receivedAt)}</td>
              <td>{e.source === 'OFFLINE_SYNC' ? '离线补传' : e.source}</td>
              <td className={e.result === 'ACCEPTED' ? 'ok-text' : 'error'}>
                {RESULT_TEXT[e.result] ?? e.result}
                {e.reason ? `（${REASON_TEXT[e.reason] ?? e.reason}）` : ''}
              </td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                暂无记录
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
