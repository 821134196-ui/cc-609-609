import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, avatarFor, fmtTime } from '../api';
import { useStatus } from '../hooks';
import type { Confirmation } from '../types';

export default function DeparturePage() {
  const { id = '' } = useParams();
  const { data, reload } = useStatus(id, 4000);
  const [captain, setCaptain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ name: string; docTail: string }[]>([]);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);

  const loadConfirmations = () => api.getConfirmations(id).then(setConfirmations).catch(() => {});
  useEffect(() => {
    loadConfirmations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const confirm = async () => {
    setError(null);
    setBlocked([]);
    try {
      await api.confirmDeparture(id, captain.trim());
      await reload();
      await loadConfirmations();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.body?.notReturned)) {
        setError(e.body.message ?? '尚有未返船人员');
        setBlocked(e.body.notReturned);
      } else {
        setError(e.message);
      }
    }
  };

  if (!data) return <p>加载中…</p>;
  const departed = data.voyage.status === 'DEPARTED';

  return (
    <div>
      <section className="card">
        <h2>船长离港确认</h2>
        <p className="muted small">
          仅当本航次生效名单（v{data.activeList?.version ?? '—'}）上的实际人员全部返船后才能办理离港；确认记录将保存人员快照。
        </p>

        {departed ? (
          <div className="alert alert-info">本航次已办理离港确认。</div>
        ) : (
          <>
            {data.notReturned.length > 0 ? (
              <div className="alert alert-danger">
                <strong>未返船 {data.notReturned.length} 人：</strong>
                {data.notReturned.map((m) => `${m.name}（尾号 ${m.docTail}）`).join('、')}
              </div>
            ) : (
              <div className="alert alert-ok">生效名单人员全部在船，可以办理离港。</div>
            )}
            <div className="inline-form">
              <input
                placeholder="确认人（船长）姓名"
                value={captain}
                onChange={(e) => setCaptain(e.target.value)}
              />
              <button onClick={confirm} disabled={!captain.trim() || !data.activeList}>
                确认全部返船，办理离港
              </button>
            </div>
            {error && (
              <div className="alert alert-danger">
                <strong>{error}</strong>
                {blocked.length > 0 && (
                  <ul>
                    {blocked.map((b) => (
                      <li key={b.docTail}>
                        {b.name}（证件尾号 {b.docTail}）
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {confirmations.length > 0 && (
        <section className="card">
          <h2>离港确认记录</h2>
          {confirmations.map((c) => (
            <div key={c.id} className="confirmation">
              <p>
                <strong>{c.confirmedBy}</strong> 于 {fmtTime(c.createdAt)} 确认离港（对应名单 v{c.listVersion}，共{' '}
                {c.snapshot.length} 人）：
              </p>
              <div className="member-grid">
                {c.snapshot.map((s) => (
                  <div key={s.memberId} className="member-card">
                    <img src={avatarFor(s.name)} alt={s.name} className="avatar" />
                    <div className="member-info">
                      <div className="member-name">{s.name}</div>
                      <div className="muted">证件尾号 {s.docTail}</div>
                      <span className="badge badge-onboard">在船</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
