/**
 * 港口船员登离轮系统 e2e 验证：
 * 1. 临时换班后旧名单通行权限失效、新名单生效；
 * 2. 离线补传按 occurredAt 归位，晚返船记录不丢失；
 * 3. 离线重复补传 / 重复扫码按事件号去重，同一人不会被算两次返船；
 * 4. 离港确认必须本航次生效名单上的实际人员全部返船，快照对应实际人员；
 * 5. 证件遗失暂停通行，状态处理后方可恢复。
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const SERVER_DIR = path.join(__dirname, '..');
const TEST_DB_URL = 'file:./test-e2e.db';
const DB_FILE = path.join(SERVER_DIR, 'prisma', 'test-e2e.db');

process.env.DATABASE_URL = TEST_DB_URL;

const prisma = new PrismaClient();

// 测试用船员（证件号即扫码内容）
const A = { name: '张伟', docNo: 'E00000001' };
const B = { name: '王强', docNo: 'E00000002' };
const C = { name: '李芳', docNo: 'E00000003' };
const D = { name: '刘洋', docNo: 'E00000004' };

const T = (s: string) => `2026-10-01T${s}:00.000Z`;

describe('港口船员登离轮通行系统 (e2e)', () => {
  let app: INestApplication;

  beforeAll(() => {
    for (const suffix of ['', '-journal']) fs.rmSync(DB_FILE + suffix, { force: true });
    execSync('npx prisma migrate deploy', {
      cwd: SERVER_DIR,
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      stdio: 'inherit',
    });
  }, 120000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    for (const suffix of ['', '-journal']) fs.rmSync(DB_FILE + suffix, { force: true });
  });

  beforeEach(async () => {
    await prisma.passEvent.deleteMany();
    await prisma.departureConfirmation.deleteMany();
    await prisma.crewMember.deleteMany();
    await prisma.crewList.deleteMany();
    await prisma.voyage.deleteMany();
  });

  const api = () => request(app.getHttpServer());

  async function createVoyage(no: string) {
    const res = await api().post('/api/voyages').send({ voyageNo: no, vessel: '测试轮' }).expect(201);
    return res.body.id as string;
  }

  async function submitList(voyageId: string, members: { name: string; docNo: string }[], note?: string) {
    const res = await api()
      .post(`/api/voyages/${voyageId}/lists`)
      .send({ submittedBy: '代理甲', note, members })
      .expect(201);
    return res.body;
  }

  async function scan(eventNo: string, voyageId: string, docNo: string, direction: 'ASHORE' | 'RETURN', occurredAt: string, source?: string) {
    const res = await api()
      .post('/api/scan')
      .send({ eventNo, voyageId, docNo, direction, occurredAt, source });
    return res.body;
  }

  async function batch(events: any[]) {
    const res = await api().post('/api/scan/batch').send({ events }).expect(201);
    return res.body.results as any[];
  }

  const statusOf = async (voyageId: string) => (await api().get(`/api/voyages/${voyageId}/status`).expect(200)).body;

  it('1. 临时换班提交新版名单后，旧名单通行权限失效、新名单生效', async () => {
    const v = await createVoyage('V-TEST-1');
    await submitList(v, [A, B, C]);

    expect((await scan('e1', v, A.docNo, 'ASHORE', T('08:00'))).result).toBe('ACCEPTED');
    expect((await scan('e2', v, C.docNo, 'ASHORE', T('08:01'))).result).toBe('ACCEPTED');

    // 临时换班：李芳(C) 下船，刘洋(D) 上船 → 提交 v2
    await submitList(v, [A, B, D], '临时换班：李芳下、刘洋上');

    // 旧名单人员（C/李芳）的通行权限不得继续使用
    const denied = await scan('e3', v, C.docNo, 'RETURN', T('09:00'));
    expect(denied.result).toBe('REJECTED');
    expect(denied.reason).toBe('NO_PERMISSION');

    // 留任人员（A）与新上人员（D）正常通行
    expect((await scan('e4', v, A.docNo, 'RETURN', T('09:05'))).result).toBe('ACCEPTED');
    expect((await scan('e5', v, D.docNo, 'ASHORE', T('09:10'))).result).toBe('ACCEPTED');

    // 名单变更历史可查询
    const lists = (await api().get(`/api/voyages/${v}/lists`).expect(200)).body;
    expect(lists).toHaveLength(2);
    expect(lists.find((l: any) => l.version === 1).status).toBe('SUPERSEDED');
    expect(lists.find((l: any) => l.version === 2).status).toBe('ACTIVE');

    const st = await statusOf(v);
    expect(st.activeList.version).toBe(2);
    expect(st.members.map((m: any) => m.name).sort()).toEqual(['刘洋', '张伟', '王强']);
    const byName = Object.fromEntries(st.members.map((m: any) => [m.name, m]));
    expect(byName['张伟'].state).toBe('ON_BOARD'); // 已返船
    expect(byName['王强'].state).toBe('ON_BOARD'); // 未登岸过
    expect(byName['刘洋'].state).toBe('ASHORE');
    expect(st.notReturned.map((m: any) => m.name)).toEqual(['刘洋']);
    // 被换下且仍在岸上的李芳出现在警示区，而不是未返船名单
    expect(st.removedAshore.map((r: any) => r.name)).toEqual(['李芳']);
  });

  it('2. 离线补传按 occurredAt 归位：乱序补传状态正确，晚返船记录不丢失', async () => {
    const v = await createVoyage('V-TEST-2');
    await submitList(v, [A, B]);

    await scan('a1', v, A.docNo, 'ASHORE', T('08:00'));
    await scan('b1', v, B.docNo, 'ASHORE', T('08:05'));

    // B 深夜返船，设备离线，次日才补传 → 晚返船记录必须生效
    const [r] = await batch([
      { eventNo: 'b2', voyageId: v, docNo: B.docNo, direction: 'RETURN', occurredAt: T('23:40'), source: 'OFFLINE_SYNC' },
    ]);
    expect(r.result).toBe('ACCEPTED');

    let st = await statusOf(v);
    let byName = Object.fromEntries(st.members.map((m: any) => [m.name, m]));
    expect(byName['王强'].state).toBe('ON_BOARD');
    expect(st.notReturned.map((m: any) => m.name)).toEqual(['张伟']);

    // A 的离线记录乱序补传：更晚的登岸(23:55)先传，较早的返船(23:50)后传
    await batch([{ eventNo: 'a3', voyageId: v, docNo: A.docNo, direction: 'ASHORE', occurredAt: T('23:55'), source: 'OFFLINE_SYNC' }]);
    await batch([{ eventNo: 'a2', voyageId: v, docNo: A.docNo, direction: 'RETURN', occurredAt: T('23:50'), source: 'OFFLINE_SYNC' }]);
    st = await statusOf(v);
    byName = Object.fromEntries(st.members.map((m: any) => [m.name, m]));
    // 状态按 occurredAt 最新者（23:55 登岸）归位，而不是按上传顺序
    expect(byName['张伟'].state).toBe('ASHORE');

    // A 最终返船（23:59）补传到账 → 全部在船
    await batch([{ eventNo: 'a4', voyageId: v, docNo: A.docNo, direction: 'RETURN', occurredAt: T('23:59'), source: 'OFFLINE_SYNC' }]);
    st = await statusOf(v);
    expect(st.notReturned).toHaveLength(0);
  });

  it('3. 离线重复补传与重复扫码按事件号去重，同一人不会被算两次返船', async () => {
    const v = await createVoyage('V-TEST-3');
    await submitList(v, [A]);

    expect((await scan('s1', v, A.docNo, 'ASHORE', T('08:00'))).result).toBe('ACCEPTED');

    // 离线补传包内含：新返船事件 s2、s2 的重复、以及已在线登记过的 s1
    const results = await batch([
      { eventNo: 's2', voyageId: v, docNo: A.docNo, direction: 'RETURN', occurredAt: T('22:00'), source: 'OFFLINE_SYNC' },
      { eventNo: 's2', voyageId: v, docNo: A.docNo, direction: 'RETURN', occurredAt: T('22:00'), source: 'OFFLINE_SYNC' },
      { eventNo: 's1', voyageId: v, docNo: A.docNo, direction: 'ASHORE', occurredAt: T('08:00'), source: 'OFFLINE_SYNC' },
    ]);
    expect(results.map((r) => r.result)).toEqual(['ACCEPTED', 'DUPLICATE', 'DUPLICATE']);
    expect(results[1].originalResult).toBe('ACCEPTED');

    // 同一事件号再次单独补传 → 仍是 DUPLICATE
    expect((await scan('s2', v, A.docNo, 'RETURN', T('22:00'))).result).toBe('DUPLICATE');

    // 全航次仅一条被接受的返船记录 —— 同一人不会被算两次返船
    const events = (await api().get(`/api/voyages/${v}/events`).expect(200)).body;
    expect(events.filter((e: any) => e.result === 'ACCEPTED' && e.direction === 'RETURN')).toHaveLength(1);
    expect(events.filter((e: any) => e.result === 'ACCEPTED')).toHaveLength(2);

    const st = await statusOf(v);
    expect(st.notReturned).toHaveLength(0);
    expect(st.members[0].state).toBe('ON_BOARD');
  });

  it('4. 离港确认必须本航次实际人员全部返船，确认快照对应生效名单', async () => {
    const v = await createVoyage('V-TEST-4');
    await submitList(v, [A, B, C]);
    await scan('d1', v, A.docNo, 'ASHORE', T('08:00'));
    await scan('d2', v, B.docNo, 'ASHORE', T('08:01'));
    await scan('d3', v, C.docNo, 'ASHORE', T('08:02'));

    // 换班：C(李芳) 被换下（其在岸上的记录不再属于本航次应返人员）
    await submitList(v, [A, B], '临时换班');
    expect((await scan('d4', v, C.docNo, 'RETURN', T('09:00'))).reason).toBe('NO_PERMISSION');

    // A、B 均未返船 → 船长不能办理离港，返回具体未返船人员（不是只看人数）
    const denied = await api().post(`/api/voyages/${v}/confirm-departure`).send({ confirmedBy: '船长老王' }).expect(409);
    expect(denied.body.notReturned.map((n: any) => n.name).sort()).toEqual(['张伟', '王强']);

    // 只返一人仍不行
    await scan('d5', v, A.docNo, 'RETURN', T('09:30'));
    const denied2 = await api().post(`/api/voyages/${v}/confirm-departure`).send({ confirmedBy: '船长老王' }).expect(409);
    expect(denied2.body.notReturned.map((n: any) => n.name)).toEqual(['王强']);

    // 全部返船 → 确认成功，快照 = 本航次生效名单的实际人员（张伟、王强，不含被换下的李芳）
    await scan('d6', v, B.docNo, 'RETURN', T('09:40'));
    const ok = await api().post(`/api/voyages/${v}/confirm-departure`).send({ confirmedBy: '船长老王' }).expect(201);
    expect(ok.body.confirmation.listVersion).toBe(2);
    expect(ok.body.confirmation.snapshot.map((s: any) => s.name).sort()).toEqual(['张伟', '王强']);
    expect(ok.body.confirmation.snapshot.every((s: any) => s.state === 'ON_BOARD')).toBe(true);

    // 离港后扫码一律拒绝；重复确认被拒绝
    expect((await scan('d7', v, A.docNo, 'ASHORE', T('10:00'))).reason).toBe('VOYAGE_CLOSED');
    await api().post(`/api/voyages/${v}/confirm-departure`).send({ confirmedBy: 'x' }).expect(409);

    // 离港确认记录可查询
    const confs = (await api().get(`/api/voyages/${v}/confirmations`).expect(200)).body;
    expect(confs).toHaveLength(1);
    expect(confs[0].confirmedBy).toBe('船长老王');
  });

  it('5. 证件遗失先暂停通行，状态处理后方可恢复，暂停未归者阻塞离港', async () => {
    const v = await createVoyage('V-TEST-5');
    const list = await submitList(v, [A]);
    const memberId = list.members[0].id as string;

    await scan('m1', v, A.docNo, 'ASHORE', T('08:00'));

    // 证件遗失 → 暂停通行
    await api().post(`/api/members/${memberId}/suspend`).send({ note: '证件遗失' }).expect(201);
    const blocked = await scan('m2', v, A.docNo, 'RETURN', T('09:00'));
    expect(blocked.result).toBe('REJECTED');
    expect(blocked.reason).toBe('MEMBER_SUSPENDED');

    // 暂停期间仍未返船 → 不能离港
    const denied = await api().post(`/api/voyages/${v}/confirm-departure`).send({ confirmedBy: '船长' }).expect(409);
    expect(denied.body.notReturned.map((n: any) => n.name)).toEqual(['张伟']);

    // 状态处理（证件补办）→ 恢复通行 → 返船 → 可离港
    await api().post(`/api/members/${memberId}/resolve`).send({ note: '证件已补办' }).expect(201);
    expect((await scan('m3', v, A.docNo, 'RETURN', T('09:30'))).result).toBe('ACCEPTED');
    await api().post(`/api/voyages/${v}/confirm-departure`).send({ confirmedBy: '船长' }).expect(201);
  });
});
