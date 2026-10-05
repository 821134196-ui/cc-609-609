import { useParams } from 'react-router-dom';
import { api, avatarFor, fmtTime } from '../api';
import { useStatus } from '../hooks';
import type { Member } from '../types';

function MemberCard({ m, onChanged }: { m: Member; onChanged: () => void }) {
  const act = async (action: 'suspend' | 'resolve') => {
    const note =
      window.prompt(action === 'suspend' ? '暂停原因（如：证件遗失）' : '处理说明（如：证件已补办）') ?? '';
    try {
      if (action === 'suspend') await api.suspendMember(m.id, note || undefined);
      else await api.resolveMember(m.id, note || undefined);
      onChanged();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className={`member-card ${m.state === 'ASHORE' ? 'ashore' : ''} ${m.status === 'SUSPENDED' ? 'suspended' : ''}`}>
      <img src={m.photoUrl || avatarFor(m.name)} alt={m.name} className="avatar" />
      <div className="member-info">
        <div className="member-name">{m.name}</div>
        <div className="muted">证件尾号 {m.docTail}</div>
        <div className="badges">
          <span className={`badge ${m.state === 'ON_BOARD' ? 'badge-onboard' : 'badge-ashore'}`}>
            {m.state === 'ON_BOARD' ? '在船' : '未返船'}
          </span>
          {m.status === 'SUSPENDED' && <span className="badge badge-suspended">已暂停通行</span>}
        </div>
        <div className="muted small">
          {m.lastEventAt
            ? `${m.lastDirection === 'RETURN' ? '返船' : '登岸'}于 ${fmtTime(m.lastEventAt)}`
            : '本航次暂无通行记录'}
        </div>
        {m.status === 'SUSPENDED' && m.statusNote && <div className="muted small">备注：{m.statusNote}</div>}
      </div>
      <div className="member-actions">
        {m.status === 'NORMAL' ? (
          <button className="btn-warn" onClick={() => act('suspend')}>
            证件遗失
          </button>
        ) : (
          <button className="btn-ok" onClick={() => act('resolve')}>
            解除暂停
          </button>
        )}
      </div>
    </div>
  );
}

export default function WatchPage() {
  const { id = '' } = useParams();
  const { data, error, reload } = useStatus(id, 4000);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>加载中…</p>;

  return (
    <div>
      {data.voyage.status === 'DEPARTED' && (
        <div className="alert alert-info">本航次已办理离港确认，通行权限已全部关闭。</div>
      )}

      {data.notReturned.length > 0 ? (
        <div className="alert alert-danger">
          <strong>未返船 {data.notReturned.length} 人：</strong>
          {data.notReturned.map((m) => `${m.name}（尾号 ${m.docTail}）`).join('、')}
        </div>
      ) : (
        <div className="alert alert-ok">生效名单人员全部在船。</div>
      )}

      {data.removedAshore.length > 0 && (
        <div className="alert alert-warn">
          <strong>提示：</strong>以下人员已从生效名单移除（换班换下），其通行权限已失效，最后一次记录为登岸：
          {data.removedAshore.map((r) => `${r.name ?? '未知'}（尾号 ${r.docTail}）`).join('、')}
        </div>
      )}

      <section className="card">
        <h2>
          值守状态板{' '}
          <span className="muted small">
            （生效名单 v{data.activeList?.version ?? '—'}，每 4 秒自动刷新）
          </span>
        </h2>
        {data.members.length === 0 && <p className="muted">尚无生效名单，请先在「代理名单」页提交。</p>}
        <div className="member-grid">
          {data.members.map((m) => (
            <MemberCard key={m.id} m={m} onChanged={reload} />
          ))}
        </div>
      </section>
    </div>
  );
}
