import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface MemberInput {
  name: string;
  docNo: string;
  photoUrl?: string;
}

/**
 * 计算航次值守状态板。
 * 核心规则：每名船员的当前状态 = 该证件号在本航次「已接受」事件中
 * occurredAt（事件发生时间，而非上传时间）最新的一条的方向。
 * 因此离线补传、乱序补传、重复补传都不会影响状态的正确性。
 */
export async function computeStatus(db: Db, voyageId: string) {
  const voyage = await db.voyage.findUnique({
    where: { id: voyageId },
    include: { lists: { include: { members: true }, orderBy: { version: 'desc' } } },
  });
  if (!voyage) throw new NotFoundException('航次不存在');

  const activeList = voyage.lists.find((l) => l.status === 'ACTIVE') ?? null;

  const accepted = await db.passEvent.findMany({
    where: { voyageId, result: 'ACCEPTED' },
    orderBy: [{ occurredAt: 'asc' }, { receivedAt: 'asc' }],
  });
  // 同一证件号按 occurredAt（并列时按 receivedAt）取最后一条
  const lastByDoc = new Map<string, (typeof accepted)[number]>();
  for (const e of accepted) lastByDoc.set(e.docNo, e);

  const members = (activeList?.members ?? []).map((m) => {
    const last = lastByDoc.get(m.docNo);
    const state = !last || last.direction === 'RETURN' ? 'ON_BOARD' : 'ASHORE';
    return {
      ...m,
      state,
      lastDirection: last?.direction ?? null,
      lastEventAt: last?.occurredAt ?? null,
    };
  });

  const notReturned = members.filter((m) => m.state === 'ASHORE');

  // 已从生效名单移除（换班换下）但最后一次记录仍是登岸的人员 —— 仅作警示，不阻塞离港
  const activeDocs = new Set(members.map((m) => m.docNo));
  const nameByDoc = new Map<string, string>();
  for (const l of voyage.lists) {
    for (const m of l.members) {
      if (!nameByDoc.has(m.docNo)) nameByDoc.set(m.docNo, m.name);
    }
  }
  const removedAshore = [...lastByDoc.entries()]
    .filter(([doc, e]) => !activeDocs.has(doc) && e.direction === 'ASHORE')
    .map(([doc, e]) => ({
      docNo: doc,
      docTail: doc.slice(-4),
      name: nameByDoc.get(doc) ?? null,
      lastEventAt: e.occurredAt,
    }));

  return {
    voyage: {
      id: voyage.id,
      voyageNo: voyage.voyageNo,
      vessel: voyage.vessel,
      status: voyage.status,
      createdAt: voyage.createdAt,
    },
    activeList: activeList
      ? {
          id: activeList.id,
          version: activeList.version,
          submittedBy: activeList.submittedBy,
          note: activeList.note,
          createdAt: activeList.createdAt,
        }
      : null,
    members,
    notReturned,
    removedAshore,
  };
}

@Injectable()
export class VoyageService {
  constructor(private prisma: PrismaService) {}

  createVoyage(dto: { voyageNo?: string; vessel?: string }) {
    if (!dto?.voyageNo?.trim() || !dto?.vessel?.trim()) {
      throw new BadRequestException('voyageNo（航次号）与 vessel（船名）必填');
    }
    return this.prisma.voyage.create({
      data: { voyageNo: dto.voyageNo.trim(), vessel: dto.vessel.trim() },
    });
  }

  listVoyages() {
    return this.prisma.voyage.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        lists: { where: { status: 'ACTIVE' }, select: { version: true } },
        confirmations: { select: { confirmedBy: true, createdAt: true } },
      },
    });
  }

  /**
   * 代理提交新版名单（含临时换班）：旧版本置为 SUPERSEDED，
   * 旧名单上人员的通行权限立即失效（扫码时按生效名单校验）。
   */
  async submitList(
    voyageId: string,
    dto: { submittedBy?: string; note?: string; members?: MemberInput[] },
  ) {
    if (!dto?.submittedBy?.trim()) throw new BadRequestException('submittedBy（提交人）必填');
    const members = dto.members;
    if (!Array.isArray(members) || members.length === 0) {
      throw new BadRequestException('名单不能为空');
    }
    const seen = new Set<string>();
    for (const m of members) {
      if (!m?.name?.trim() || !m?.docNo?.trim()) {
        throw new BadRequestException('每名船员必须填写姓名与证件号');
      }
      const doc = m.docNo.trim();
      if (doc.length < 4) throw new BadRequestException(`证件号 ${doc} 过短（至少 4 位）`);
      if (seen.has(doc)) throw new BadRequestException(`名单内证件号重复：${doc}`);
      seen.add(doc);
    }

    return this.prisma.$transaction(async (tx) => {
      const voyage = await tx.voyage.findUnique({
        where: { id: voyageId },
        include: { lists: true },
      });
      if (!voyage) throw new NotFoundException('航次不存在');
      if (voyage.status !== 'OPEN') {
        throw new ConflictException('航次已办理离港，不能再提交名单');
      }
      await tx.crewList.updateMany({
        where: { voyageId, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED' },
      });
      const version = voyage.lists.reduce((max, l) => Math.max(max, l.version), 0) + 1;
      return tx.crewList.create({
        data: {
          voyageId,
          version,
          submittedBy: dto.submittedBy!.trim(),
          note: dto.note?.trim() || null,
          members: {
            create: members.map((m) => ({
              name: m.name.trim(),
              docNo: m.docNo.trim(),
              docTail: m.docNo.trim().slice(-4),
              photoUrl: m.photoUrl?.trim() || null,
            })),
          },
        },
        include: { members: true },
      });
    });
  }

  getLists(voyageId: string) {
    return this.prisma.crewList.findMany({
      where: { voyageId },
      orderBy: { version: 'desc' },
      include: { _count: { select: { members: true } } },
    });
  }

  async getListMembers(voyageId: string, version: number) {
    const list = await this.prisma.crewList.findFirst({
      where: { voyageId, version },
      include: { members: { orderBy: { name: 'asc' } } },
    });
    if (!list) throw new NotFoundException('名单版本不存在');
    return list;
  }

  getStatus(voyageId: string) {
    return computeStatus(this.prisma, voyageId);
  }

  async getEvents(
    voyageId: string,
    q: { direction?: string; result?: string; docNo?: string },
  ) {
    const where: Prisma.PassEventWhereInput = { voyageId };
    if (q.direction) where.direction = q.direction;
    if (q.result) where.result = q.result;
    if (q.docNo) where.docNo = q.docNo;
    const events = await this.prisma.passEvent.findMany({
      where,
      orderBy: [{ receivedAt: 'desc' }],
      include: { member: { select: { name: true } } },
      take: 500,
    });
    return events.map((e) => ({
      id: e.id,
      eventNo: e.eventNo,
      direction: e.direction,
      source: e.source,
      result: e.result,
      reason: e.reason,
      occurredAt: e.occurredAt,
      receivedAt: e.receivedAt,
      docNo: e.docNo,
      docTail: e.docNo.slice(-4),
      memberName: e.member?.name ?? null,
    }));
  }

  /**
   * 船长离港确认：必须本航次生效名单上的实际人员全部在船。
   * 确认记录保存人员快照，航次随后置为 DEPARTED，此后扫码一律拒绝。
   */
  async confirmDeparture(voyageId: string, confirmedBy?: string) {
    if (!confirmedBy?.trim()) throw new BadRequestException('confirmedBy（确认人/船长）必填');
    return this.prisma.$transaction(async (tx) => {
      const status = await computeStatus(tx, voyageId);
      if (status.voyage.status !== 'OPEN') {
        throw new ConflictException('该航次已办理离港确认');
      }
      if (!status.activeList) {
        throw new ConflictException('该航次尚无生效名单，不能办理离港');
      }
      if (status.notReturned.length > 0) {
        throw new ConflictException({
          message: '尚有未返船人员，不能办理离港',
          notReturned: status.notReturned.map((m) => ({
            id: m.id,
            name: m.name,
            docTail: m.docTail,
          })),
        });
      }
      const snapshot = status.members.map((m) => ({
        memberId: m.id,
        name: m.name,
        docTail: m.docTail,
        state: m.state,
      }));
      const confirmation = await tx.departureConfirmation.create({
        data: {
          voyageId,
          confirmedBy: confirmedBy.trim(),
          listVersion: status.activeList.version,
          snapshot: JSON.stringify(snapshot),
        },
      });
      await tx.voyage.update({ where: { id: voyageId }, data: { status: 'DEPARTED' } });
      return { confirmation: { ...confirmation, snapshot } };
    });
  }

  async getConfirmations(voyageId: string) {
    const rows = await this.prisma.departureConfirmation.findMany({
      where: { voyageId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) as unknown }));
  }

  /** 证件遗失：暂停通行；状态处理（找回/补办）后恢复 */
  async setMemberStatus(memberId: string, action: 'suspend' | 'resolve', note?: string) {
    const member = await this.prisma.crewMember.findUnique({
      where: { id: memberId },
      include: { list: true },
    });
    if (!member) throw new NotFoundException('船员不存在');
    if (member.list.status !== 'ACTIVE') {
      throw new BadRequestException('只能操作当前生效名单中的船员');
    }
    if (action === 'suspend') {
      if (member.status === 'SUSPENDED') throw new BadRequestException('该船员已处于暂停状态');
      return this.prisma.crewMember.update({
        where: { id: memberId },
        data: { status: 'SUSPENDED', statusNote: note?.trim() || '证件遗失，暂停通行' },
      });
    }
    if (member.status !== 'SUSPENDED') throw new BadRequestException('该船员未被暂停');
    return this.prisma.crewMember.update({
      where: { id: memberId },
      data: { status: 'NORMAL', statusNote: note?.trim() || null },
    });
  }
}
