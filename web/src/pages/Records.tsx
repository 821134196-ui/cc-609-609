import { useEffect, useState } from 'react';
import { api } from '../api';

const DIR_LABEL: Record<string, string> = {
  DISEMBARK: '登岸',
  EMBARK: '返船',
  RELIEVED: '换班交接',
};

export function Records() {
  const [voyages, setVoyages] = useState<any[]>([]);
  const [voyageId, setVoyageId] = useState('');
  const [certNo, setCertNo] = useState('');
  const [direction, setDirection] = useState('');
  const [source, setSource] = useState('');
  const [events, setEvents] = useState<any[]>([]);

  async function load() {
    const q = new URLSearchParams();
    if (voyageId) q.set('voyageId', voyageId);
    if (certNo.trim()) q.set('certNo', certNo.trim());
    if (direction) q.set('direction', direction);
    if (source) q.set('source', source);
    setEvents(await api(`/events?${q.toString()}`));
  }

  useEffect(() => { api('/voyages').then(setVoyages); }, []);
  useEffect(() => { load(); }, [voyageId, direction, source]);

  return (
    <div className="panel">
      <h2>人员通行记录查询</h2>
      <p className="hint">名单变更见「代理名单」页版本记录；这里可查全部通行事件，含离线补传（OFFLINE）与换班交接（RELIEVED）。</p>
      <div className="row">
        <div className="field">
          <label>航次</label>
          <select value={voyageId} onChange={(e) => setVoyageId(e.target.value)}>
            <option value="">全部航次</option>
            {voyages.map((v) => (
              <option key={v.id} value={v.id}>{v.vesselName} · {v.voyageNo}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>证件号包含</label>
          <input className="mono" value={certNo} onChange={(e) => setCertNo(e.target.value)} placeholder="C-1004" />
        </div>
        <div className="field">
          <label>方向</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">全部</option>
            <option value="DISEMBARK">登岸</option>
            <option value="EMBARK">返船</option>
            <option value="RELIEVED">换班交接</option>
          </select>
        </div>
        <div className="field">
          <label>来源</label>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">全部</option>
            <option value="ONLINE">在线扫码</option>
            <option value="OFFLINE">离线补传</option>
          </select>
        </div>
        <button className="btn primary" onClick={load}>查询</button>
      </div>

      <div style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>扫码时间</th><th>航次</th><th>姓名</th><th>证件号/尾号</th>
              <th>事件</th><th>来源</th><th>事件号</th><th>接收时间</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.scannedAt).toLocaleString('zh-CN')}</td>
                <td>{e.voyageNo}</td>
                <td>{e.name}</td>
                <td className="mono">{e.certNo}（{e.certLast4}）</td>
                <td>
                  <span className={`badge ${e.direction === 'DISEMBARK' ? 'ashore' : 'aboard'}`}>
                    {DIR_LABEL[e.direction] ?? e.direction}
                  </span>
                </td>
                <td>
                  <span className={`badge ${e.source === 'OFFLINE' ? 'offline' : 'online'}`}>
                    {e.source === 'OFFLINE' ? '离线补传' : '在线'}
                  </span>
                </td>
                <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.eventId}</td>
                <td className="dim">{new Date(e.receivedAt).toLocaleTimeString('zh-CN')}</td>
              </tr>
            ))}
            {!events.length && (
              <tr><td colSpan={8} className="dim">没有符合条件的记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
