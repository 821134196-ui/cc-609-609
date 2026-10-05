import { useEffect, useState } from 'react';
import {
  api, loadQueue, saveQueue, syncBatch, newEventId, QueuedEvent,
} from '../api';
import { useToast } from '../toast';

interface ScanResult {
  allowed?: boolean;
  duplicate?: boolean;
  reason?: string;
  message?: string;
  person?: any;
  direction?: string;
  state?: string;
  voyageNo?: string;
}

export function GangwayScan() {
  const toast = useToast();
  const [voyages, setVoyages] = useState<any[]>([]);
  const [voyageId, setVoyageId] = useState<number | undefined>();
  const [certNo, setCertNo] = useState('C-1001');
  const [direction, setDirection] = useState<'DISEMBARK' | 'EMBARK'>('DISEMBARK');
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<QueuedEvent[]>(loadQueue());
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastEvent, setLastEvent] = useState<QueuedEvent | null>(null);
  const [syncReport, setSyncReport] = useState<any>(null);

  async function refresh() {
    const list = await api('/voyages');
    setVoyages(list);
    if (!voyageId) {
      const open = list.find((v: any) => v.status === 'OPEN');
      if (open) setVoyageId(open.id);
    }
  }
  useEffect(() => { refresh(); }, []);

  /** 扫码：设备总是先生成事件号；在线直发，离线入本地队列 */
  async function scan(ev: QueuedEvent, label: string) {
    setLastEvent(ev);
    if (offline) {
      const q = [...loadQueue(), ev];
      saveQueue(q);
      setQueue(q);
      setResult({ allowed: true, message: `${label}：已存入本地离线队列（事件号 ${ev.eventId}），恢复网络后补传` });
      return;
    }
    setBusy(true);
    try {
      const r = await api('/scan', {
        method: 'POST',
        body: JSON.stringify({ ...ev, voyageId }),
      });
      setResult(r);
    } catch (e: any) {
      setResult({ allowed: false, message: e.message });
    } finally {
      setBusy(false);
    }
  }

  const newScan = () => {
    if (!certNo.trim()) return toast('err', '请输入或模拟扫码证件号');
    scan(
      { eventId: newEventId(), certNo: certNo.trim(), direction, scannedAt: new Date().toISOString() },
      direction === 'DISEMBARK' ? '登岸' : '返船',
    );
  };

  /** 模拟设备重复扫码 / 重发：复用同一事件号 */
  const resendLast = () => {
    if (!lastEvent) return toast('info', '尚无已扫事件');
    scan({ ...lastEvent }, '重复扫码');
  };

  /** 离线恢复后补传整批；重复点也只会入库一次（后端按 eventId 去重） */
  async function uploadQueue() {
    const q = loadQueue();
    if (!q.length) return toast('info', '离线队列为空');
    setBusy(true);
    try {
      const r = await syncBatch(q, voyageId);
      setSyncReport(r);
      saveQueue([]);
      setQueue([]);
      toast('ok', `补传完成：接受 ${r.acceptedCount}，重复 ${r.duplicateCount}，拒绝 ${r.rejectedCount}`);
    } catch (e: any) {
      toast('err', e.message);
    } finally {
      setBusy(false);
    }
  }

  /** 模拟整批补传两次（设备重试），验证重复批次去重 */
  async function doubleUpload() {
    const q = loadQueue();
    if (!q.length) return toast('info', '离线队列为空');
    setBusy(true);
    try {
      const first = await syncBatch(q, voyageId);
      const second = await syncBatch(q, voyageId); // 同一批事件号再次补传
      setSyncReport({ ...second, firstRun: first });
      saveQueue([]);
      setQueue([]);
      toast('ok', `首次接受 ${first.acceptedCount}；第二次全部判定重复 ${second.duplicateCount}，未重复计数`);
    } catch (e: any) {
      toast('err', e.message);
    } finally {
      setBusy(false);
    }
  }

  const clearQueue = () => { saveQueue([]); setQueue([]); };

  return (
    <div>
      <div className="panel">
        <h2>船梯口扫码登记</h2>
        <p className="hint">
          证件核验通过后扫码登记登岸 / 返船；每次扫码由设备生成唯一事件号，重复扫码按事件号去重。
          断网时事件存入本地队列，恢复后补传，不丢晚返船记录。
        </p>
        <div className="row">
          <div className="field">
            <label>航次</label>
            <select value={voyageId ?? ''} onChange={(e) => setVoyageId(Number(e.target.value))}>
              {voyages.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vesselName} · {v.voyageNo} {v.status === 'DEPARTED' ? '（已离港）' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>证件号（模拟扫码）</label>
            <input className="mono" value={certNo} onChange={(e) => setCertNo(e.target.value)} />
          </div>
          <div className="field">
            <label>方向</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
              <option value="DISEMBARK">登岸 DISEMBARK</option>
              <option value="EMBARK">返船 EMBARK</option>
            </select>
          </div>
          <div className="field">
            <label>网络</label>
            <select value={offline ? 'off' : 'on'} onChange={(e) => setOffline(e.target.value === 'off')}>
              <option value="on">在线</option>
              <option value="off">离线（本地缓存）</option>
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={busy} onClick={newScan}>
            {busy ? '处理中…' : `扫码${direction === 'DISEMBARK' ? '登岸' : '返船'}`}
          </button>
          <button className="btn ghost" onClick={resendLast}>用同一事件号重复扫码</button>
          <span className="badge offline" style={{ display: offline ? '' : 'none' }}>离线模式：{queue.length} 条待补传</span>
        </div>

        {result && (
          <div className={`scan-result ${result.duplicate ? 'dup' : result.allowed ? 'ok' : 'deny'}`}>
            <strong>
              {result.duplicate ? '重复扫码（已忽略，不重复计数）'
                : result.allowed ? (result.direction === 'DISEMBARK' ? '✅ 登岸登记成功' : '✅ 返船登记成功')
                : '⛔ 拒绝通行'}
            </strong>
            <div className="dim" style={{ marginTop: 4 }}>
              {result.message}
              {result.person && <> · {result.person.name}（证件尾号 {result.person.certLast4}）</>}
              {result.state && <> · 当前状态：{result.state === 'ASHORE' ? '在岸上' : '在船'}</>}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>离线补传队列</h2>
        <p className="hint">断网期间所有扫码按发生时间保存在本地；补传时后端按事件号去重，乱序到达也按扫码时间归并。</p>
        <div className="queue-box">
          {queue.length === 0 && <span className="dim">队列为空</span>}
          {queue.map((e) => (
            <div key={e.eventId} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
              <span className="mono">{e.eventId}</span>
              <span>{e.certNo}</span>
              <span className={`badge ${e.direction === 'DISEMBARK' ? 'ashore' : 'aboard'}`}>
                {e.direction === 'DISEMBARK' ? '登岸' : '返船'}
              </span>
              <span className="dim">{new Date(e.scannedAt).toLocaleTimeString('zh-CN')}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn green" disabled={busy || !queue.length || offline} onClick={uploadQueue}>
            恢复网络 · 补传队列
          </button>
          <button className="btn amber" disabled={busy || !queue.length || offline} onClick={doubleUpload}>
            模拟整批重复补传两次
          </button>
          <button className="btn ghost sm" onClick={clearQueue}>清空队列</button>
          <span className="dim">{offline ? '当前离线，先切回在线再补传' : ''}</span>
        </div>

        {syncReport && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 14 }}>上次补传结果</h3>
            <table>
              <thead><tr><th>事件号</th><th>姓名/证件</th><th>方向</th><th>扫码时间</th></tr></thead>
              <tbody>
                {syncReport.accepted?.map((a: any) => (
                  <tr key={a.eventId}>
                    <td className="mono">{a.eventId}</td><td>{a.name} {a.certNo}</td>
                    <td>{a.direction === 'DISEMBARK' ? '登岸' : '返船'}</td>
                    <td>{new Date(a.scannedAt).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dim" style={{ marginTop: 8 }}>
              接受 {syncReport.acceptedCount} · 重复去重 {syncReport.duplicateCount} ·
              拒绝 {syncReport.rejectedCount}
              {syncReport.firstRun && `（第一次接受 ${syncReport.firstRun.acceptedCount}，第二次重复 ${syncReport.duplicateCount}）`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
