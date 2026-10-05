import { NavLink, Link, Outlet, useParams } from 'react-router-dom';
import { useStatus } from '../hooks';

const TABS = [
  { to: 'watch', label: '值守页' },
  { to: 'gate', label: '船梯口扫码' },
  { to: 'agent', label: '代理名单' },
  { to: 'events', label: '通行记录' },
  { to: 'departure', label: '离港确认' },
];

export default function VoyageLayout() {
  const { id = '' } = useParams();
  const { data } = useStatus(id);

  return (
    <div className="page">
      <header className="voyage-header">
        <div>
          <Link to="/" className="muted">
            ← 航次列表
          </Link>
          <h1>
            {data ? `${data.voyage.vessel} / ${data.voyage.voyageNo}` : '加载中…'}{' '}
            {data && (
              <span className={`badge ${data.voyage.status === 'OPEN' ? 'badge-open' : 'badge-departed'}`}>
                {data.voyage.status === 'OPEN' ? '在港' : '已离港'}
              </span>
            )}{' '}
            {data?.activeList && <span className="badge badge-list">名单 v{data.activeList.version}</span>}
          </h1>
        </div>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={`/v/${id}/${t.to}`} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
