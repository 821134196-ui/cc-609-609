import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtTime } from '../api';
import type { ListDetail, ListVersion } from '../types';

interface Row {
  name: string;
  docNo: string;
  photoUrl: string;
}

export default function AgentPage() {
  const { id = '' } = useParams();
  const [lists, setLists] = useState<ListVersion[]>([]);
  const [selected, setSelected] = useState<ListDetail | null>(null);
  const [submittedBy, setSubmittedBy] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([{ name: '', docNo: '', photoUrl: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    try {
      setLists(await api.getLists(id));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const viewVersion = async (version: number) => {
    setSelected(await api.getListMembers(id, version));
  };

  const prefillFromActive = async () => {
    const active = lists.find((l) => l.status === 'ACTIVE');
    if (!active) return;
    const detail = await api.getListMembers(id, active.version);
    setRows(detail.members.map((m) => ({ name: m.name, docNo: m.docNo, photoUrl: m.photoUrl ?? '' })));
    setNote(`基于 v${active.version} 换班调整`);
  };

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    try {
      const res = await api.submitList(id, {
        submittedBy: submittedBy.trim(),
        note: note.trim() || undefined,
        members: rows
          .filter((r) => r.name.trim() || r.docNo.trim())
          .map((r) => ({ name: r.name.trim(), docNo: r.docNo.trim(), photoUrl: r.photoUrl.trim() || undefined })),
      });
      setOkMsg(`名单 v${res.version} 已提交并生效，旧版本通行权限已失效。`);
      setRows([{ name: '', docNo: '', photoUrl: '' }]);
      setNote('');
      await loadLists();
      setSelected(res);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <section className="card">
        <h2>提交新版名单（含临时换班）</h2>
        <p className="muted small">
          提交后新版本立即生效，旧版本名单人员的通行权限同时失效。换班可点击「基于当前生效名单修改」后调整人员。
        </p>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              提交人（代理）
              <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} required placeholder="如：代理-小李" />
            </label>
            <label>
              备注（换班原因等）
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填" />
            </label>
          </div>
          <table className="edit-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>证件号</th>
                <th>照片 URL（选填）</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="姓名" />
                  </td>
                  <td>
                    <input value={r.docNo} onChange={(e) => setRow(i, { docNo: e.target.value })} placeholder="证件号" />
                  </td>
                  <td>
                    <input value={r.photoUrl} onChange={(e) => setRow(i, { photoUrl: e.target.value })} placeholder="留空则自动生成头像" />
                  </td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={() => setRows((rs) => [...rs, { name: '', docNo: '', photoUrl: '' }])}>
              + 添加人员
            </button>
            <button type="button" className="btn-secondary" onClick={prefillFromActive} disabled={!lists.some((l) => l.status === 'ACTIVE')}>
              基于当前生效名单修改
            </button>
            <button type="submit">提交并生效</button>
          </div>
        </form>
        {error && <p className="error">{error}</p>}
        {okMsg && <p className="ok-text">{okMsg}</p>}
      </section>

      <section className="card">
        <h2>名单版本历史</h2>
        {lists.length === 0 && <p className="muted">尚未提交名单</p>}
        <table>
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>人数</th>
              <th>提交人</th>
              <th>提交时间</th>
              <th>备注</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => (
              <tr key={l.id}>
                <td>v{l.version}</td>
                <td>
                  <span className={`badge ${l.status === 'ACTIVE' ? 'badge-open' : 'badge-departed'}`}>
                    {l.status === 'ACTIVE' ? '生效中' : '已失效'}
                  </span>
                </td>
                <td>{l._count.members}</td>
                <td>{l.submittedBy}</td>
                <td>{fmtTime(l.createdAt)}</td>
                <td>{l.note ?? '—'}</td>
                <td>
                  <button className="btn-secondary" onClick={() => viewVersion(l.version)}>
                    查看
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected && (
          <div className="list-detail">
            <h3>
              v{selected.version} 人员名单（{selected.members.length} 人）
              {selected.status === 'ACTIVE' ? '（生效中）' : '（已失效）'}
            </h3>
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>证件号</th>
                  <th>尾号</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {selected.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.docNo}</td>
                    <td>{m.docTail}</td>
                    <td>{m.status === 'SUSPENDED' ? '已暂停通行' : '正常'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
