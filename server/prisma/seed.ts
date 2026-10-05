import { PrismaClient } from '@prisma/client';
import { avatarDataUri } from '../src/util/avatar';

const prisma = new PrismaClient();

async function main() {
  // 清空（重复执行种子保持幂等：按事件→名单→航次→船→人员顺序）
  await prisma.accessEvent.deleteMany();
  await prisma.manifestEntry.deleteMany();
  await prisma.manifestVersion.deleteMany();
  await prisma.voyage.deleteMany();
  await prisma.vessel.deleteMany();
  await prisma.person.deleteMany();

  const vessel = await prisma.vessel.create({
    data: { name: '远洋号', imo: 'IMO-9001' },
  });

  // 已完成的上一航次
  const old = await prisma.voyage.create({
    data: {
      vesselId: vessel.id,
      voyageNo: 'V-2609',
      status: 'DEPARTED',
      openedAt: new Date('2026-09-28T08:00:00Z'),
      departedAt: new Date('2026-10-01T20:00:00Z'),
    },
  });

  // 当前开放航次
  const cur = await prisma.voyage.create({
    data: { vesselId: vessel.id, voyageNo: 'V-2610' },
  });

  const mk = (name: string, certNo: string) =>
    prisma.person.create({
      data: {
        name,
        certNo,
        certLast4: certNo.slice(-4),
        photo: avatarDataUri(name, certNo),
      },
    });

  const crew = await Promise.all([
    mk('张伟', 'C-1001'),
    mk('李娜', 'C-1002'),
    mk('王强', 'C-1003'),
    mk('赵敏', 'C-1004'),
  ]);

  await prisma.manifestVersion.create({
    data: {
      voyageId: cur.id,
      versionNo: 1,
      submittedBy: '代理-周敏',
      note: '初始名单',
      entries: {
        create: crew.map((p, i) => ({
          personId: p.id,
          role: ['船长', '大副', '轮机员', '水手'][i],
        })),
      },
    },
  });

  // 上一航次名单（用于记录查询演示）
  await prisma.manifestVersion.create({
    data: {
      voyageId: old.id,
      versionNo: 1,
      submittedBy: '代理-周敏',
      note: '上一航次名单',
      superseded: true,
      entries: {
        create: crew.slice(0, 3).map((p) => ({ personId: p.id, role: '船员' })),
      },
    },
  });

  console.log('✔ seed 完成: 远洋号 V-2610（4 人初始名单）');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
