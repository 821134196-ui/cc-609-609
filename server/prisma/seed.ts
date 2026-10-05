import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 本地演示用的 SVG 头像（data URI，离线可用）
function avatar(name: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${color}"/><text x="48" y="62" font-size="42" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${name[0]}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const CREW = [
  { name: '张伟', docNo: 'E12345678', color: '#4f6bed' },
  { name: '王强', docNo: 'E23456789', color: '#0e7a5f' },
  { name: '李芳', docNo: 'E34567890', color: '#b04a6b' },
  { name: '陈杰', docNo: 'E45678901', color: '#8a6d1d' },
  { name: '刘洋', docNo: 'E56789012', color: '#5b4a9e' },
];

async function main() {
  const existing = await prisma.voyage.findUnique({ where: { voyageNo: 'V2026-1001' } });
  if (existing) {
    console.log('种子数据已存在（航次 V2026-1001），跳过。');
    return;
  }
  const voyage = await prisma.voyage.create({
    data: { voyageNo: 'V2026-1001', vessel: '远洋号' },
  });
  await prisma.crewList.create({
    data: {
      voyageId: voyage.id,
      version: 1,
      submittedBy: '代理-小李',
      note: '本航次初始名单',
      members: {
        create: CREW.map((m) => ({
          name: m.name,
          docNo: m.docNo,
          docTail: m.docNo.slice(-4),
          photoUrl: avatar(m.name, m.color),
        })),
      },
    },
  });
  console.log(`已创建示例航次 V2026-1001（远洋号），名单 v1 共 ${CREW.length} 人。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
