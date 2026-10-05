import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';

interface Voyage { id: number; voyageNo: string; vesselName: string; status: string; }

const SAMPLE = `张伟 C-1001 船长
李娜 C-1002 大副
王强 C-1003 轮机员
赵敏 C-1004 水手`;

const RELIEF_SAMPLE = `张伟 C-1001 船长
李娜 C-1002 大副
王强 C-1003 轮机员
孙杰 C-2001 水手（换班接替赵敏）
陈晨 C-2002 见习船员`;

export function AgentManifest() {
  const toast = useToast();
  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [voyageNo, setVoyageNo] = useState('V-2610');
  const [vesselName, setVesselName] = useState('远洋号');
  const [imo, setImo] = useState('IMO-9001');
  const [submittedBy, setSubmittedBy] = useState('代理-周敏');
  const [note, setNote] = useState('');
  const [members, setMembers] = useState(SAMPLE);
  const [versions, setVersions] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function loadVoyages() {
    setVoyages(await api('/voyages'));
  }

  async function loadVersions(no: string) {
    const v = voyages.find((x) => x.voyageNo === no);
    if (v) setVersions(await api(`/voyages/${v.id}/versions`));
  }

  useEffect(() => { loadVoyages(); }, []);
  useEffect(() => { loadVersions(voyageNo); }, [voyageNo, voyages]);

  async function submit() {
    const rows = members
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, certNo, ...roleParts] = l.split(/\s+/);
        return { name, certNo, role: roleParts.join(' ') || '船员' };
      });
    if (!voyageNo || !submittedBy) return toast('err', '请填写航次号和提交人');
    if (rows.some((r) => !r.name || !r.certNo))
      return toast('err', '每行格式：姓名 证件号 [职务]');
    setSubmitting(true);
    try {
      const r = await api('/manifests', {
        method: 'POST',
        body: JSON.stringify({ voyageNo, vesselName, imo, submittedBy, note, members: rows }),
      });
      toast('ok', `名单 v${r.versionNo} 已提交，共 ${r.members.length} 人；旧版本权限已按新版处理`);
      setNote('');
      await loadVoyages();
      setVersions(await api(`/voyages/${r.voyageId}/versions`));
    } catch (e: any) {
      toast('err', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="panel">
        <h2>代理提交本航次人员名单</h2>
        <p className="hint">
          临时换班：对同一航次号提交新版名单即可，旧版本自动失效，仍在岸上的被换人员按交接处理，不再占用未返船名额。
        </p>
        <div className="row">
          <div className="field">
            <label>航次号（换班沿用同一航次号）</label>
            <input value={voyageNo} onChange={(e) => setVoyageNo(e.target.value)} />
          </div>
          <div className="field">
            <label>船名（仅新航次需要）</label>
            <input value={vesselName} onChange={(e) => setVesselName(e.target.value)} />
          </div>
          <div className="field">
            <label>IMO 编号（仅新航次需要）</label>
            <input value={imo} onChange={(e) => setImo(e.target.value)} />
          </div>
          <div className="field">
            <label>提交代理</label>
            <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field" style={{ flex: 2 }}>
            <label>名单（每行：姓名 证件号 [职务]）</label>
            <textarea value={members} onChange={(e) => setMembers(e.target.value)} />
          </div>
          <div className="field">
            <label>变更说明</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：临时换班，赵敏下船" />
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn ghost sm" onClick={() => setMembers(SAMPLE)}>初始名单样例</button>
              <button className="btn ghost sm" onClick={() => setMembers(RELIEF_SAMPLE)}>换班名单样例</button>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={submitting} onClick={submit}>
            {submitting ? '提交中…' : '提交 / 换班提交新版'}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>名单版本记录 — {voyageNo}</h2>
        <p className="hint">每次提交生成新版本，旧版本标记为已替代但保留可查。</p>
        {versions.map((v) => (
          <div key={v.id} style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <span className={`badge ${v.superseded ? 'old' : 'v'}`}>v{v.versionNo}</span>{' '}
                {v.superseded ? <span className="dim">已被替代</span> : <strong style={{ color: 'var(--green)' }}>当前生效</strong>}
                <span className="dim" style={{ marginLeft: 10 }}>{new Date(v.submittedAt).toLocaleString('zh-CN')} · {v.submittedBy}</span>
              </div>
              <span className="dim">{v.note}</span>
            </div>
            <table style={{ marginTop: 6 }}>
              <thead><tr><th>姓名</th><th>证件号</th><th>尾号</th><th>职务</th><th>证件状态</th></tr></thead>
              <tbody>
                {v.members.map((m: any) => (
                  <tr key={m.personId}>
                    <td>{m.name}</td>
                    <td className="mono">{m.certNo}</td>
                    <td className="mono">{m.certLast4}</td>
                    <td>{m.role}</td>
                    <td>{m.status === 'SUSPENDED'
                      ? <span className="badge suspended">已暂停</span>
                      : <span className="dim">正常</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {!versions.length && <p className="dim">该航次暂无名单记录</p>}
      </div>
    </div>
  );
}
