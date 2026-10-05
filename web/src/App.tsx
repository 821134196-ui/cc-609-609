import { useState } from 'react';
import { ToastProvider } from './toast';
import { AgentManifest } from './pages/AgentManifest';
import { GangwayScan } from './pages/GangwayScan';
import { DutyDashboard } from './pages/DutyDashboard';
import { Records } from './pages/Records';

const TABS = [
  { key: 'duty', label: '值守核对 / 离港', Comp: DutyDashboard },
  { key: 'agent', label: '代理名单 / 换班', Comp: AgentManifest },
  { key: 'scan', label: '船梯口扫码', Comp: GangwayScan },
  { key: 'records', label: '记录查询', Comp: Records },
] as const;

export function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('duty');
  const Active = TABS.find((t) => t.key === tab)!.Comp;
  return (
    <ToastProvider>
      <header className="topbar">
        <h1>🚢 船员登离轮身份核对与岸上通行系统</h1>
        <span className="sub">按航次管理 · 逐人核对 · 事件号去重</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <Active key={tab} />
      </main>
    </ToastProvider>
  );
}
