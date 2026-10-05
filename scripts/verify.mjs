// 端到端验证：换班权限 / 晚返船名单 / 离线重复补传去重 / 离港必须逐人对应本航次
// 使用独立测试库 verify.db，结束后自动清理。
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(root, 'server');
const PORT = 3091;
const BASE = `http://localhost:${PORT}/api`;
const DB_URL = 'file:./verify.db';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

// ---------- 准备：独立库 + 构建 + 起服务 ----------
console.log('\n[准备] 构建后端并初始化测试库…');
const env = { ...process.env, DATABASE_URL: DB_URL, PORT: String(PORT) };
spawnSync('npx prisma db push --force-reset', { cwd: serverDir, shell: true, stdio: 'inherit', env });
spawnSync('rm -rf dist tsconfig.tsbuildinfo', { cwd: serverDir, shell: true });
spawnSync('npx nest build', { cwd: serverDir, shell: true, stdio: 'inherit' });

const srv = spawn('node', ['dist/main.js'], {
  cwd: serverDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', () => {});
srv.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/voyages`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('服务启动超时');
}

let exitCode = 0;
try {
  await waitReady();
  console.log('[准备] 服务已就绪\n');

  const crew = [
    { name: '张伟', certNo: 'T-9101', role: '船长' },
    { name: '李娜', certNo: 'T-9102', role: '大副' },
    { name: '王强', certNo: 'T-9103', role: '轮机员' },
    { name: '赵敏', certNo: 'T-9104', role: '水手' },
    { name: '周琦', certNo: 'T-9105', role: '厨师' },
  ];

  // ---------- 场景 1：初始名单 ----------
  console.log('【场景1】代理提交初始名单 v1（5 人）');
  let r = await api('/manifests', { method: 'POST', body: JSON.stringify({
    voyageNo: 'T-VOY-1', vesselName: '验证船', imo: 'IMO-T1',
    submittedBy: '测试代理', note: '初始名单', members: crew,
  })});
  check('名单 v1 提交成功', r.status === 201 && r.data.versionNo === 1);
  const voyageId = r.data.voyageId;

  r = await api(`/voyages/${voyageId}/dashboard`);
  const d0 = r.data;
  check('初始全员默认在船，未返船为 0', d0.total === 5 && d0.ashoreCount === 0 && d0.notReturned.length === 0);

  // ---------- 场景 2：全部登岸，3 人返船 ----------
  console.log('\n【场景2】5 人全部登岸，其中 3 人在线返船');
  let i = 0;
  for (const c of crew) {
    const out = await api('/scan', { method: 'POST', body: JSON.stringify({
      eventId: `EV-OUT-${c.certNo}`, certNo: c.certNo, direction: 'DISEMBARK' })});
    check(`${c.name} 登岸成功`, out.status === 201 && out.data.allowed && !out.data.duplicate);
  }
  for (const c of crew.slice(0, 3)) {
    const back = await api('/scan', { method: 'POST', body: JSON.stringify({
      eventId: `EV-IN-${c.certNo}`, certNo: c.certNo, direction: 'EMBARK' })});
    check(`${c.name} 返船成功`, back.data.allowed && back.data.state === 'ABOARD');
  }
  r = await api(`/voyages/${voyageId}/dashboard`);
  check('未返船=2，且是具体的赵敏、周琦（不是只数人头）',
    r.data.ashoreCount === 2 &&
    eq(r.data.notReturned.map((x) => x.name).sort(), ['周琦', '赵敏']),
    JSON.stringify(r.data.notReturned));

  // ---------- 场景 3：人数未到齐，离港被拒 ----------
  console.log('\n【场景3】船长尝试离港 → 必须返回具体未返船人员');
  r = await api(`/voyages/${voyageId}/depart`, { method: 'POST', body: JSON.stringify({ confirmedBy: '船长' }) });
  check('离港被拒绝（409）', r.status === 409);
  check('拒绝原因 NOT_ALL_RETURNED 且带名单',
    r.data?.reason === 'NOT_ALL_RETURNED' &&
    eq(r.data.notReturned.map((x) => x.name).sort(), ['周琦', '赵敏']),
    JSON.stringify(r.data));

  // ---------- 场景 4：离线补传——晚返船 + 批次内重复 + 未知证件 ----------
  console.log('\n【场景4】船梯口离线：赵敏晚返船；同一事件号在批次内重复；夹带未知证件');
  const t1 = new Date(Date.now() + 1000).toISOString();
  const batch = [
    { eventId: 'EV-OFF-D-IN', certNo: 'T-9104', direction: 'EMBARK', scannedAt: t1 }, // 赵敏晚返船
    { eventId: 'EV-OFF-D-IN', certNo: 'T-9104', direction: 'EMBARK', scannedAt: t1 }, // 批次内重复
    { eventId: 'EV-OFF-X', certNo: 'NO-SUCH', direction: 'EMBARK', scannedAt: t1 },   // 未知证件
  ];
  r = await api('/sync', { method: 'POST', body: JSON.stringify({ voyageId, batchId: 'B1', events: batch })});
  check('补传：接受 1（晚返船）、批次内重复 1、拒绝 1',
    r.data.acceptedCount === 1 && r.data.duplicateCount === 1 && r.data.rejectedCount === 1,
    JSON.stringify({ a: r.data.acceptedCount, d: r.data.duplicateCount, x: r.data.rejectedCount }));
  check('接受的事件标记为 OFFLINE', r.data.accepted[0].eventId === 'EV-OFF-D-IN');
  check('补传后未返船只剩周琦',
    eq(r.data.notReturned.map((x) => x.name), ['周琦']),
    JSON.stringify(r.data.notReturned));

  console.log('  —— 设备重试：同一批事件号整批补传第二次 ——');
  r = await api('/sync', { method: 'POST', body: JSON.stringify({ voyageId, batchId: 'B1-RETRY', events: batch })});
  check('第二次补传接受 0，全部按事件号判重（晚返船不会被算成两次）',
    r.data.acceptedCount === 0 && r.data.duplicateCount === 2 && r.data.rejectedCount === 1,
    JSON.stringify({ a: r.data.acceptedCount, d: r.data.duplicateCount }));
  r = await api(`/voyages/${voyageId}/dashboard`);
  check('赵敏仍只计为 1 人且状态在船',
    r.data.aboardCount === 4 &&
    r.data.roster.find((x) => x.certNo === 'T-9104').state === 'ABOARD');

  // ---------- 场景 5：临时换班，旧名单权限失效 ----------
  console.log('\n【场景5】代理换班提交 v2：周琦下船（仍在岸），孙杰、陈晨上船');
  r = await api('/manifests', { method: 'POST', body: JSON.stringify({
    voyageNo: 'T-VOY-1', submittedBy: '测试代理', note: '临时换班：周琦下船',
    members: [
      crew[0], crew[1], crew[2], crew[3],
      { name: '孙杰', certNo: 'T-9201', role: '水手' },
      { name: '陈晨', certNo: 'T-9202', role: '见习' },
    ],
  })});
  check('名单 v2 提交成功，v1 标记替代', r.status === 201 && r.data.versionNo === 2);

  r = await api(`/voyages/${voyageId}/dashboard`);
  const d2 = r.data;
  check('当前应在船=6（新人孙杰、陈晨计入）', d2.total === 6);
  check('被换走的周琦不再出现在未返船名单（产生 RELIEVED 交接）',
    d2.notReturned.every((x) => x.name !== '周琦') && d2.ashoreCount === 0);
  check('当前名单不含周琦、含孙杰陈晨',
    !d2.roster.some((x) => x.certNo === 'T-9105') &&
    d2.roster.some((x) => x.certNo === 'T-9201') &&
    d2.roster.some((x) => x.certNo === 'T-9202'));

  console.log('  —— 旧名单权限不得继续使用 ——');
  r = await api('/scan', { method: 'POST', body: JSON.stringify({
    eventId: 'EV-ZHOU-AFTER', certNo: 'T-9105', direction: 'DISEMBARK' })});
  check('周琦换班后在线扫码被拒 NOT_ON_MANIFEST',
    r.status === 201 && !r.data.allowed && r.data.reason === 'NOT_ON_MANIFEST');

  const afterSwap = new Date().toISOString();
  r = await api('/sync', { method: 'POST', body: JSON.stringify({ voyageId, events: [
    { eventId: 'EV-OFF-ZHOU-LATE', certNo: 'T-9105', direction: 'DISEMBARK', scannedAt: afterSwap },
  ]})});
  check('换班之后才发生的补传事件被拒（权限不延续）',
    r.data.rejectedCount === 1 && r.data.rejected[0].reason === 'NOT_ON_MANIFEST');

  // 换班之前发生的历史离线事件（设备缓存了很久）应保留
  const beforeSwap = new Date(Date.now() - 60_000).toISOString();
  r = await api('/sync', { method: 'POST', body: JSON.stringify({ voyageId, events: [
    { eventId: 'EV-OFF-ZHOU-OLD', certNo: 'T-9105', direction: 'DISEMBARK', scannedAt: beforeSwap },
  ]})});
  check('换班之前发生的历史事件按当时 v1 名单接受',
    r.data.acceptedCount === 1 && r.data.rejectedCount === 0);

  // ---------- 场景 6：证件遗失暂停 ----------
  console.log('\n【场景6】孙杰证件遗失 → 暂停 → 扫码拒绝 → 处理后恢复');
  r = await api('/persons/suspend', { method: 'POST', body: JSON.stringify({ certNo: 'T-9201' }) });
  check('证件暂停成功', r.status === 201 && r.data.status === 'SUSPENDED');
  r = await api('/scan', { method: 'POST', body: JSON.stringify({
    eventId: 'EV-SUN-OUT', certNo: 'T-9201', direction: 'DISEMBARK' })});
  check('暂停期间登岸被拒 SUSPENDED', !r.data.allowed && r.data.reason === 'SUSPENDED');
  await api('/persons/resume', { method: 'POST', body: JSON.stringify({ certNo: 'T-9201' }) });
  r = await api('/scan', { method: 'POST', body: JSON.stringify({
    eventId: 'EV-SUN-OUT', certNo: 'T-9201', direction: 'DISEMBARK' })});
  check('恢复后同一事件号首次登记成功（未被暂停期失败请求占用）',
    r.data.allowed && !r.data.duplicate && r.data.state === 'ASHORE');
  // 重复扫码
  r = await api('/scan', { method: 'POST', body: JSON.stringify({
    eventId: 'EV-SUN-OUT', certNo: 'T-9201', direction: 'DISEMBARK' })});
  check('同一事件号重复扫码 → duplicate，不重复计数',
    r.data.allowed && r.data.duplicate === true);
  r = await api(`/voyages/${voyageId}/dashboard`);
  check('未返船仅孙杰 1 人（重复扫码没有变成 2 人次）',
    r.data.ashoreCount === 1 && eq(r.data.notReturned.map((x) => x.name), ['孙杰']));

  // ---------- 场景 7：晚返船归位后，离港必须逐人对应本航次实际人员 ----------
  console.log('\n【场景7】孙杰晚返船 → 未返船清零 → 船长离港确认（6 人）');
  r = await api('/scan', { method: 'POST', body: JSON.stringify({
    eventId: 'EV-SUN-IN', certNo: 'T-9201', direction: 'EMBARK' })});
  check('孙杰晚返船登记成功，状态在船', r.data.state === 'ABOARD');
  r = await api(`/voyages/${voyageId}/dashboard`);
  check('逐人核对：6 人全部在船（含换班新人，不含周琦）',
    r.data.total === 6 && r.data.ashoreCount === 0,
    JSON.stringify(r.data.notReturned));

  r = await api(`/voyages/${voyageId}/depart`, { method: 'POST', body: JSON.stringify({ confirmedBy: '船长' }) });
  check('离港确认成功，headcount=6 对应 v2 实际名单',
    r.status === 201 && r.data.ok && r.data.headcount === 6 && r.data.voyage.status === 'DEPARTED',
    JSON.stringify(r.data));

  console.log('  —— 离港后闸口关闭 ——');
  r = await api('/scan', { method: 'POST', body: JSON.stringify({
    eventId: 'EV-AFTER-DEP', certNo: 'T-9101', direction: 'DISEMBARK', voyageId })});
  check('离港后在线扫码拒绝 VOYAGE_DEPARTED', !r.data.allowed && r.data.reason === 'VOYAGE_DEPARTED');
  r = await api('/sync', { method: 'POST', body: JSON.stringify({ voyageId, events: [
    { eventId: 'EV-OFF-AFTER', certNo: 'T-9101', direction: 'EMBARK', scannedAt: new Date().toISOString() },
  ]})});
  check('离港后离线补传拒绝（409）', r.status === 409);
  r = await api('/manifests', { method: 'POST', body: JSON.stringify({
    voyageNo: 'T-VOY-1', submittedBy: '测试代理', members: crew.slice(0, 2) })});
  check('已离港航次不能再换班提交名单（409）', r.status === 409);

  // ---------- 场景 8：记录可查询（通行 + 名单变更） ----------
  console.log('\n【场景8】变更与通行记录可查询');
  r = await api(`/events?voyageId=${voyageId}&source=OFFLINE`);
  check('可查离线补传记录（晚返船/历史事件均在）',
    r.status === 200 && r.data.some((e) => e.eventId === 'EV-OFF-D-IN') &&
    r.data.some((e) => e.eventId === 'EV-OFF-ZHOU-OLD'));
  r = await api(`/events?voyageId=${voyageId}&direction=RELIEVED`);
  check('可查换班交接记录（周琦）',
    r.data.length === 1 && r.data[0].name === '周琦' && r.data[0].direction === 'RELIEVED');
  r = await api(`/voyages/${voyageId}/versions`);
  check('名单两个版本均可查，v1 已替代 / v2 生效',
    r.data.length === 2 && r.data[0].versionNo === 2 && r.data[0].superseded === false &&
    r.data[1].versionNo === 1 && r.data[1].superseded === true);

  // 事件号全局唯一：库里每个 eventId 只有一行（重复扫码/补传绝不产生第二条）
  r = await api(`/events?voyageId=${voyageId}`);
  const ids = r.data.map((e) => e.eventId);
  check('同一事件号在库中只存一条（去重落库）', new Set(ids).size === ids.length);
} catch (e) {
  console.error('验证脚本异常：', e);
  exitCode = 1;
} finally {
  srv.kill();
  await sleep(300);
  for (const f of ['verify.db', 'verify.db-journal']) {
    try { rmSync(join(serverDir, 'prisma', f)); } catch {}
  }
  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========\n`);
  process.exit(exitCode || (fail ? 1 : 0));
}
