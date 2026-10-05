import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtTime } from '../api';
import type { VoyageSummary } from '../types';

export default function VoyagesPage() {
  const [voyages, setVoyages] = useState<VoyageSummary[]>([]);
  const [voyageNo, setVoyageNo] = useState('');
  const [vessel, setVessel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listVoyages().then(setVoyages).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createVoyage({ voyageNo: voyageNo.trim(), vessel: vessel.trim() });
      setVoyageNo('');
      setVessel('');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <h1>港口船员登离轮通行系统</h1>
      <p className="muted">船员登岸 / 返船按航次管理，离港前须逐人核对返船情况。</p>

      <section className="card">
        <h2>新建航次</h2>
        <form onSubmit={submit} className="inline-form">
          <input
            placeholder="航次号，如 V2026-1002"
            value={voyageNo}
            onChange={(e) => setVoyageNo(e.target.value)}
            required
          />
          <input placeholder="船名，如 远洋号" value={vessel} onChange={(e) => setVessel(e.target.value)} required />
          <button type="submit">创建航次</button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>航次列表</h2>
        {voyages.length === 0 && <p className="muted">暂无航次</p>}
        <table>
          <thead>
            <tr>
              <th>航次号</th>
              <th>船名</th>
              <th>状态</th>
              <th>生效名单</th>
              <th>创建时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {voyages.map((v) => (
              <tr key={v.id}>
                <td>{v.voyageNo}</td>
                <td>{v.vessel}</td>
                <td>
                  <span className={`badge ${v.status === 'OPEN' ? 'badge-open' : 'badge-departed'}`}>
                    {v.status === 'OPEN' ? '在港' : '已离港'}
                  </span>
                </td>
                <td>{v.lists[0] ? `v${v.lists[0].version}` : '—'}</td>
                <td>{fmtTime(v.createdAt)}</td>
                <td>
                  <Link to={`/v/${v.id}/watch`}>进入 →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
