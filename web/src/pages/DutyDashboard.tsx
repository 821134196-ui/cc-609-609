import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';

export function DutyDashboard() {
  const toast = useToast();
  const [voyages, setVoyages] = useState<any[]>([]);
  const [voyageId, setVoyageId] = useState<number | undefined>();
  const [dash, setDash] = useState<any>(null);
  const [certInput, setCertInput] = useState('C-1004');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const list = await api('/voyages');
    setVoyages(list);
    const id = voyageId ?? list.find((v: any) => v.status === 'OPEN')?.id ?? list[0]?.id;
    if (id) {
      setVoyageId(id);
      setDash(await api(`/voyages/${id}/dashboard`));
    }
  }, [voyageId]);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const t = setInterval(async () => {
      if (voyageId) setDash(await api(`/voyages/${voyageId}/dashboard`));
    }, 5000);
    return () => clearInterval(t);
  }, [voyageId]);

  async function changeVoyage(id: number) {
    setVoyageId(id);
    setDash(await api(`/voyages/${id}/dashboard`));
  }

  async function depart() {
    setBusy(true);
    try {
      const r = await api(`/voyages/${voyageId}/depart`, {
        method: 'POST',
        body: JSON.stringify({ confirmedBy: '船长' }),
      });
      toast('ok', `✅ ${r.voyage.vesselName} ${r.voyage.voyageNo} 已确认离港，在船核对 ${r.headcount} 人`);
      await refresh();
    } catch (e: any) {
      toast('err', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function suspend(action: 'suspend' | 'resume') {
    if (!certInput.trim()) return toast('err', '请输入证件号');
    try {
      await api(`/persons/${action}`, {
        method: 'POST',
        body: JSON.stringify({ certNo: certInput.trim() }),
      });
      toast('ok', action === 'suspend' ? '证件已暂停：该人员船梯口将被拒绝通行，直到状态处理' : '证件已恢复通行');
      await refresh();
    } catch (e: any) {
      toast('err', e.message);
    }
  }

  const departed = dash?.voyage?.status === 'DEPARTED';

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>值守核对页 — 船长离港确认</h2>
          <select style={{ width: 280 }} value={voyageId ?? ''} onChange={(e) => changeVoyage(Number(e.target.value))}>
            {voyages.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vesselName} · {v.voyageNo} {v.status === 'DEPARTED' ? '（已离港）' : '（开放中）'}
              </option>
            ))}
          </select>
        </div>

        {dash?.voyage && (
          <>
            <p className="hint">
              {dash.voyage.vesselName} · 航次 {dash.voyage.voyageNo} · 名单 v{dash.version?.versionNo ?? '-'}
              （{dash.version?.note || dash.version?.submittedBy}）
              {departed && ` · 已于 ${new Date(dash.voyage.departedAt).toLocaleString('zh-CN')} 离港`}
            </p>

            <div className="stat">
              <div><div className="num">{dash.total}</div><div className="lbl">本航次应在船人数（当前名单）</div></div>
              <div><div className="num green">{dash.aboardCount}</div><div className="lbl">在船</div></div>
              <div><div className="num red">{dash.ashoreCount}</div><div className="lbl">未返船（逐人核对）</div></div>
            </div>

            {dash.notReturned.length > 0 && (
              <div className="miss-list">
                <strong style={{ color: 'var(--red)' }}>⛔ 以下人员尚未返船，不能办理离港：</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {dash.notReturned.map((p: any) => (
                    <li key={p.personId}>
                      {p.name}（证件尾号 <span className="mono">{p.certLast4}</span>）
                      最后登岸：{p.lastEventAt ? new Date(p.lastEventAt).toLocaleTimeString('zh-CN') : '-'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {dash.notReturned.length === 0 && dash.total > 0 && !departed && (
              <div className="miss-list" style={{ background: 'var(--soft-green)', borderColor: '#bbf7d0' }}>
                <strong style={{ color: 'var(--green)' }}>✅ 名单上每位应返船人员均已在船（逐人核对，不仅凭人数）。</strong>
              </div>
            )}

            <div className="row" style={{ marginTop: 16 }}>
              <button
                className="btn green"
                disabled={busy || departed || dash.notReturned.length > 0 || dash.total === 0}
                onClick={depart}
              >
                {departed ? '已离港' : `船长确认 ${dash.notReturned.length > 0 ? `（缺 ${dash.ashoreCount} 人）` : '全员到齐，办理离港'}`}
              </button>
              {departed && <span className="dim">离港已锁定，扫码与补传均关闭</span>}
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>证件状态处理</h2>
        <p className="hint">证件遗失：先暂停通行，船梯口直接拒绝；相关状态处理后恢复。</p>
        <div className="row">
          <div className="field" style={{ maxWidth: 260 }}>
            <label>证件号</label>
            <input className="mono" value={certInput} onChange={(e) => setCertInput(e.target.value)} />
          </div>
          <button className="btn red" onClick={() => suspend('suspend')}>证件遗失 · 暂停通行</button>
          <button className="btn ghost" onClick={() => suspend('resume')}>状态已处理 · 恢复</button>
        </div>
      </div>

      <div className="panel">
        <h2>本航次人员状态（照片 · 证件尾号）</h2>
        <div className="grid cols-4" style={{ marginTop: 12 }}>
          {dash?.roster?.map((r: any) => (
            <div key={r.personId} className="card">
              {r.photo
                ? <img src={r.photo} alt={r.name} />
                : <div className="avatar" />}
              <div style={{ flex: 1 }}>
                <div className="name">
                  {r.name}
                  {r.certStatus === 'SUSPENDED' && <span className="badge suspended" style={{ marginLeft: 6 }}>证件暂停</span>}
                </div>
                <div className="meta">{r.role} · 尾号 <span className="mono">{r.certLast4}</span></div>
                <div style={{ marginTop: 4 }}>
                  <span className={`badge ${r.state === 'ASHORE' ? 'ashore' : 'aboard'}`}>
                    {r.state === 'ASHORE' ? '在岸上（未返船）' : '在船'}
                  </span>
                </div>
                <div className="meta" style={{ marginTop: 4 }}>
                  {r.lastEventAt ? `${r.lastDirection === 'DISEMBARK' ? '登岸' : r.lastDirection === 'EMBARK' ? '返船' : '换班交接'} · ${new Date(r.lastEventAt).toLocaleTimeString('zh-CN')}` : '暂无通行记录'}
                </div>
              </div>
            </div>
          ))}
          {!dash?.roster?.length && <p className="dim">本航次暂无名单</p>}
        </div>
      </div>
    </div>
  );
}
