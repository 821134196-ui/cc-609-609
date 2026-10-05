import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { avatarDataUri } from '../util/avatar';

export type Direction = 'DISEMBARK' | 'EMBARK' | 'RELIEVED';

export interface ManifestMemberDto {
  name: string;
  certNo: string;
  role?: string;
}

@Injectable()
export class VoyagesService {
  constructor(private prisma: PrismaService) {}

  // ---------- 航次 ----------

  async listVoyages() {
    const voyages = await this.prisma.voyage.findMany({
      orderBy: { id: 'desc' },
      include: { vessel: true, versions: true },
    });
    return voyages.map((v) => ({
      id: v.id,
      voyageNo: v.voyageNo,
      status: v.status,
      vesselName: v.vessel.name,
      imo: v.vessel.imo,
      openedAt: v.openedAt,
      departedAt: v.departedAt,
      versions: v.versions.length,
    }));
  }

  /** 最新开放航次（船梯口默认扫码对象） */
  async currentOpenVoyage() {
    const v = await this.prisma.voyage.findFirst({
      where: { status: 'OPEN' },
      orderBy: { id: 'desc' },
      include: { vessel: true },
    });
    return v;
  }

  private async requireVoyage(id: number) {
    const v = await this.prisma.voyage.findUnique({
      where: { id },
      include: { vessel: true },
    });
    if (!v) throw new NotFoundException(`航次 ${id} 不存在`);
    return v;
  }

  // ---------- 名单版本 ----------

  /**
   * 代理提交名单。
   * - 航次不存在则新建航次，版本号从 1 开始；
   * - 换班 = 同一航次提交新版本，旧版本自动 superseded；
   * - 旧版有、新版没有、且当时仍在岸上的人，写入 RELIEVED 交接事件，
   *   使其不再占用“未返船”名额（但历史记录保留）。
   */
  async submitManifest(dto: {
    voyageNo: string;
    vesselName?: string;
    imo?: string;
    submittedBy: string;
    note?: string;
    members: ManifestMemberDto[];
  }) {
    if (!dto.members?.length)
      throw new BadRequestException('名单不能为空');

    let voyage = await this.prisma.voyage.findUnique({
      where: { voyageNo: dto.voyageNo },
    });

    if (!voyage) {
      if (!dto.vesselName || !dto.imo)
        throw new BadRequestException('新航次需要提供船名和 IMO 编号');
      const vessel = await this.prisma.vessel.upsert({
        where: { imo: dto.imo },
        update: { name: dto.vesselName },
        create: { name: dto.vesselName, imo: dto.imo },
      });
      voyage = await this.prisma.voyage.create({
        data: { vesselId: vessel.id, voyageNo: dto.voyageNo },
      });
    }

    if (voyage.status === 'DEPARTED')
      throw new ConflictException('该航次已离港，换班请在新航次提交名单');

    const prevVersion = await this.prisma.manifestVersion.findFirst({
      where: { voyageId: voyage.id },
      orderBy: { versionNo: 'desc' },
      include: { entries: { include: { person: true } } },
    });

    const versionNo = (prevVersion?.versionNo ?? 0) + 1;
    const newCertNos = new Set(dto.members.map((m) => m.certNo.trim()));

    // upsert 证件持有人
    const persons = await Promise.all(
      dto.members.map(async (m) => {
        const certNo = m.certNo.trim();
        const data = {
          name: m.name.trim(),
          certLast4: certNo.slice(-4),
          photo: avatarDataUri(m.name.trim(), certNo),
        };
        return this.prisma.person.upsert({
          where: { certNo },
          update: {}, // 同一证件号保留原状态（含暂停状态），不覆盖
          create: { certNo, ...data },
        });
      }),
    );

    const version = await this.prisma.manifestVersion.create({
      data: {
        voyageId: voyage.id,
        versionNo,
        submittedBy: dto.submittedBy,
        note: dto.note,
        entries: {
          create: persons.map((p, i) => ({
            personId: p.id,
            role: dto.members[i].role?.trim() || '船员',
          })),
        },
      },
      include: { entries: { include: { person: true } } },
    });

    if (prevVersion) {
      await this.prisma.manifestVersion.update({
        where: { id: prevVersion.id },
        data: { superseded: true },
      });

      // 旧版人员的换班交接
      const states = await this.personStates(
        voyage.id,
        prevVersion.entries.map((e) => e.person),
      );
      for (const removed of prevVersion.entries) {
        if (newCertNos.has(removed.person.certNo)) continue;
        const state = states.get(removed.personId);
        // 仍在岸上（最后状态为登岸）才写交接事件；已在船的不影响未返船名单
        if (state?.latest?.direction === 'DISEMBARK') {
          await this.prisma.accessEvent
            .create({
              data: {
                eventId: `RELIEF-V${version.id}-P${removed.personId}`,
                voyageId: voyage.id,
                personId: removed.personId,
                direction: 'RELIEVED',
                scannedAt: new Date(),
                source: 'ONLINE',
              },
            })
            .catch((e) => {
              if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === 'P2002'
              )
                return; // 幂等
              throw e;
            });
        }
      }
    }

    return this.getVersion(version.id);
  }

  async listVersions(voyageId: number) {
    await this.requireVoyage(voyageId);
    const versions = await this.prisma.manifestVersion.findMany({
      where: { voyageId },
      orderBy: { versionNo: 'desc' },
      include: { entries: { include: { person: true } } },
    });
    return versions.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      submittedBy: v.submittedBy,
      note: v.note,
      superseded: v.superseded,
      submittedAt: v.submittedAt,
      members: v.entries.map((e) => ({
        personId: e.personId,
        name: e.person.name,
        certNo: e.person.certNo,
        certLast4: e.person.certLast4,
        role: e.role,
      })),
    }));
  }

  async getVersion(versionId: number) {
    const v = await this.prisma.manifestVersion.findUnique({
      where: { id: versionId },
      include: {
        entries: { include: { person: true }, orderBy: { id: 'asc' } },
      },
    });
    if (!v) throw new NotFoundException('名单版本不存在');
    return {
      id: v.id,
      voyageId: v.voyageId,
      versionNo: v.versionNo,
      submittedBy: v.submittedBy,
      note: v.note,
      superseded: v.superseded,
      submittedAt: v.submittedAt,
      members: v.entries.map((e) => ({
        personId: e.personId,
        name: e.person.name,
        certNo: e.person.certNo,
        certLast4: e.person.certLast4,
        role: e.role,
        status: e.person.status,
      })),
    };
  }

  // ---------- 人员状态计算 ----------

  /**
   * 取每个人在本航次“最后一次”通行事件（按扫码时间 scannedAt，平局按 id）。
   * 状态 = 最后事件方向：DISEMBARK→在岸，EMBARK/RELIEVED/无→在船。
   * 离线补传可能乱序到达，因此始终按事件发生时间归并，
   * 晚到的返船事件不会因为先处理过登岸而被丢弃。
   */
  async personStates(
    voyageId: number,
    persons?: { id: number }[],
  ): Promise<
    Map<
      number,
      {
        latest: { direction: Direction; scannedAt: Date } | null;
      }
    >
  > {
    const events = await this.prisma.accessEvent.findMany({
      where: {
        voyageId,
        ...(persons ? { personId: { in: persons.map((p) => p.id) } } : {}),
      },
      orderBy: [{ scannedAt: 'asc' }, { id: 'asc' }],
    });
    const map = new Map<number, { latest: { direction: Direction; scannedAt: Date } | null }>();
    for (const e of events) {
      const cur = map.get(e.personId)?.latest;
      if (!cur || e.scannedAt.getTime() >= cur.scannedAt.getTime()) {
        map.set(e.personId, {
          latest: { direction: e.direction as Direction, scannedAt: e.scannedAt },
        });
      }
    }
    if (persons) for (const p of persons) if (!map.has(p.id)) map.set(p.id, { latest: null });
    return map;
  }

  /** 当前生效版本（未 superseded 的最高版本） */
  private async currentVersion(voyageId: number) {
    return this.prisma.manifestVersion.findFirst({
      where: { voyageId },
      orderBy: { versionNo: 'desc' },
      include: { entries: { include: { person: true } } },
    });
  }

  /** 值守页：照片、证件尾号、在船/在岸状态、未返船名单 */
  async dashboard(voyageId?: number) {
    let voyage = voyageId
      ? await this.requireVoyage(voyageId)
      : await this.currentOpenVoyage();
    if (!voyage) return { voyage: null };

    const version = await this.currentVersion(voyage.id);
    if (!version)
      return {
        voyage: {
          id: voyage.id,
          voyageNo: voyage.voyageNo,
          status: voyage.status,
          vesselName: voyage.vessel.name,
        },
        version: null,
        total: 0,
        aboardCount: 0,
        ashoreCount: 0,
        roster: [],
        notReturned: [],
      };

    const states = await this.personStates(
      voyage.id,
      version.entries.map((e) => e.person),
    );

    const roster = version.entries.map((e) => {
      const latest = states.get(e.personId)?.latest ?? null;
      const ashore = latest?.direction === 'DISEMBARK';
      return {
        personId: e.personId,
        name: e.person.name,
        role: e.role,
        certNo: e.person.certNo,
        certLast4: e.person.certLast4,
        photo: e.person.photo,
        certStatus: e.person.status,
        state: ashore ? 'ASHORE' : 'ABOARD',
        lastDirection: latest?.direction ?? null,
        lastEventAt: latest?.scannedAt ?? null,
      };
    });

    // 未返船：当前名单上、最后状态仍为“登岸”的具体人员（按人而非按人数）
    const notReturned = roster.filter((r) => r.state === 'ASHORE');

    return {
      voyage: {
        id: voyage.id,
        voyageNo: voyage.voyageNo,
        status: voyage.status,
        vesselName: voyage.vessel.name,
        openedAt: voyage.openedAt,
        departedAt: voyage.departedAt,
      },
      version: {
        id: version.id,
        versionNo: version.versionNo,
        submittedBy: version.submittedBy,
        note: version.note,
        submittedAt: version.submittedAt,
      },
      total: roster.length,
      aboardCount: roster.length - notReturned.length,
      ashoreCount: notReturned.length,
      roster,
      notReturned: notReturned.map((r) => ({
        personId: r.personId,
        name: r.name,
        certLast4: r.certLast4,
        lastEventAt: r.lastEventAt,
      })),
    };
  }

  // ---------- 扫码 / 离线补传 ----------

  private async resolveVoyageForScan(voyageId?: number) {
    if (voyageId) return this.requireVoyage(voyageId);
    const v = await this.currentOpenVoyage();
    if (!v) throw new ConflictException('当前没有开放中的航次');
    return v;
  }

  /**
   * 船梯口在线扫码（本地模拟）。
   * 返回 allowed/duplicate/拒绝原因，调用方据此展示。
   */
  async scan(dto: {
    eventId: string;
    certNo: string;
    direction: 'DISEMBARK' | 'EMBARK';
    voyageId?: number;
    scannedAt?: string;
  }) {
    if (!dto.eventId) throw new BadRequestException('缺少事件号 eventId');
    if (!['DISEMBARK', 'EMBARK'].includes(dto.direction))
      throw new BadRequestException('direction 必须为 DISEMBARK 或 EMBARK');

    const dup = await this.prisma.accessEvent.findUnique({
      where: { eventId: dto.eventId },
    });
    if (dup) {
      const p = await this.prisma.person.findUnique({ where: { id: dup.personId } });
      return {
        allowed: true,
        duplicate: true,
        message: '重复扫码，已按事件号忽略',
        eventId: dup.eventId,
        person: p ? { name: p.name, certLast4: p.certLast4 } : null,
      };
    }

    const person = await this.prisma.person.findUnique({
      where: { certNo: dto.certNo.trim() },
    });
    if (!person)
      return { allowed: false, reason: 'UNKNOWN_CERT', message: '未登记证件' };

    const voyage = await this.resolveVoyageForScan(dto.voyageId);
    if (voyage.status === 'DEPARTED')
      return { allowed: false, reason: 'VOYAGE_DEPARTED', message: '航次已离港' };

    const version = await this.currentVersion(voyage.id);
    const onRoster = version?.entries.some((e) => e.personId === person.id);
    if (!onRoster)
      return {
        allowed: false,
        reason: 'NOT_ON_MANIFEST',
        message: '该人员不在本航次当前名单中（可能已换班），禁止通行',
      };

    if (person.status === 'SUSPENDED')
      return {
        allowed: false,
        reason: 'SUSPENDED',
        message: `证件已暂停（${person.statusNote ?? '遗失/处理中'}），暂停通行`,
      };

    const scannedAt = dto.scannedAt ? new Date(dto.scannedAt) : new Date();
    const event = await this.prisma.accessEvent.create({
      data: {
        eventId: dto.eventId,
        voyageId: voyage.id,
        personId: person.id,
        direction: dto.direction,
        scannedAt,
        source: 'ONLINE',
      },
    });

    const states = await this.personStates(voyage.id, [{ id: person.id }]);
    const ashore = states.get(person.id)!.latest?.direction === 'DISEMBARK';

    return {
      allowed: true,
      duplicate: false,
      eventId: event.eventId,
      voyageId: voyage.id,
      voyageNo: voyage.voyageNo,
      person: {
        personId: person.id,
        name: person.name,
        certLast4: person.certLast4,
        photo: person.photo,
      },
      direction: event.direction,
      state: ashore ? 'ASHORE' : 'ABOARD',
      message: dto.direction === 'DISEMBARK' ? '登岸登记成功' : '返船登记成功',
    };
  }

  /**
   * 离线补传：一批事件按 eventId 去重落库。
   * - 库中已存在 / 批次内重复 → duplicate，不重复计数；
   * - 人员曾出现在本航次任意版本名单即有效（换班前发生的历史扫码保留）；
   * - 不按当前在船/在岸状态拒绝事件，避免乱序补传丢掉晚返船记录。
   */
  async syncBatch(dto: {
    voyageId?: number;
    batchId?: string;
    events: {
      eventId: string;
      certNo: string;
      direction: 'DISEMBARK' | 'EMBARK';
      scannedAt: string;
    }[];
  }) {
    if (!dto.events?.length)
      throw new BadRequestException('补传批次为空');

    const voyage = await this.resolveVoyageForScan(dto.voyageId);
    if (voyage.status === 'DEPARTED')
      throw new ConflictException('航次已离港，不能补传');

    const versions = await this.prisma.manifestVersion.findMany({
      where: { voyageId: voyage.id },
      orderBy: { versionNo: 'asc' },
      include: { entries: true },
    });

    // 事件发生时刻 t 的生效版本 = submittedAt <= t 的最高版本；
    // t 早于首版提交时间时 effectiveVersionAt 按首版处理（补传事件可能略早于服务器记录时间）。
    const effectiveVersionAt = (t: Date) => {
      let effective = versions[0];
      for (const v of versions) {
        if (v.submittedAt.getTime() <= t.getTime()) effective = v;
      }
      return effective;
    };
    const everOnBoard = new Set(
      versions.flatMap((v) => v.entries.map((e) => e.personId)),
    );

    const accepted: any[] = [];
    const duplicate: string[] = [];
    const rejected: { eventId: string; reason: string; message: string }[] = [];
    const seenInBatch = new Set<string>();

    for (const ev of dto.events) {
      if (!ev.eventId || !ev.certNo || !ev.scannedAt) {
        rejected.push({
          eventId: ev.eventId ?? '(无事件号)',
          reason: 'BAD_PAYLOAD',
          message: '字段不完整',
        });
        continue;
      }
      if (seenInBatch.has(ev.eventId)) {
        duplicate.push(ev.eventId);
        continue;
      }
      seenInBatch.add(ev.eventId);

      const exists = await this.prisma.accessEvent.findUnique({
        where: { eventId: ev.eventId },
      });
      if (exists) {
        duplicate.push(ev.eventId);
        continue;
      }

      const person = await this.prisma.person.findUnique({
        where: { certNo: ev.certNo.trim() },
      });
      if (!person) {
        rejected.push({ eventId: ev.eventId, reason: 'UNKNOWN_CERT', message: '未登记证件' });
        continue;
      }
      if (!everOnBoard.has(person.id)) {
        rejected.push({
          eventId: ev.eventId,
          reason: 'NOT_ON_MANIFEST',
          message: '该人员从未出现在本航次名单中',
        });
        continue;
      }
      // 事件必须发生在该人员“仍在生效名单上”的时段内；
      // 换班移除之后补传的扫码不再有效，旧名单权限不延续。
      const t = new Date(ev.scannedAt);
      // t 早于首版提交时间时 effectiveVersionAt 按首版处理
      const effective = effectiveVersionAt(t);
      if (!effective.entries.some((e) => e.personId === person.id)) {
        rejected.push({
          eventId: ev.eventId,
          reason: 'NOT_ON_MANIFEST',
          message: '该事件发生时人员已被新版名单移除，旧名单通行权限已失效',
        });
        continue;
      }
      if (!['DISEMBARK', 'EMBARK'].includes(ev.direction)) {
        rejected.push({ eventId: ev.eventId, reason: 'BAD_DIRECTION', message: '方向非法' });
        continue;
      }

      try {
        const created = await this.prisma.accessEvent.create({
          data: {
            eventId: ev.eventId,
            voyageId: voyage.id,
            personId: person.id,
            direction: ev.direction,
            scannedAt: new Date(ev.scannedAt),
            source: 'OFFLINE',
            batchId: dto.batchId ?? null,
          },
        });
        accepted.push({
          eventId: created.eventId,
          certNo: person.certNo,
          name: person.name,
          direction: created.direction,
          scannedAt: created.scannedAt,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          duplicate.push(ev.eventId);
        } else {
          throw e;
        }
      }
    }

    const dash = await this.dashboard(voyage.id);
    return {
      voyageId: voyage.id,
      voyageNo: voyage.voyageNo,
      acceptedCount: accepted.length,
      duplicateCount: duplicate.length,
      rejectedCount: rejected.length,
      accepted,
      duplicate,
      rejected,
      notReturned: dash.notReturned,
    };
  }

  // ---------- 离港确认 ----------

  /**
   * 船长离港确认：逐人核对当前版本名单，只要还有未返船的具体人员即拒绝。
   * 人数相同不算到齐——必须每个应返船的人最后状态都是在船。
   */
  async confirmDeparture(voyageId: number, confirmedBy: string) {
    const voyage = await this.requireVoyage(voyageId);
    if (voyage.status === 'DEPARTED')
      throw new ConflictException('该航次已确认离港');

    const dash = await this.dashboard(voyageId);
    if (!dash.version)
      throw new ConflictException('航次尚无生效名单，不能离港');
    if (dash.notReturned.length > 0) {
      throw new ConflictException({
        message: `仍有 ${dash.notReturned.length} 人未返船，不能离港`,
        reason: 'NOT_ALL_RETURNED',
        notReturned: dash.notReturned,
      });
    }

    const updated = await this.prisma.voyage.update({
      where: { id: voyageId },
      data: { status: 'DEPARTED', departedAt: new Date() },
      include: { vessel: true },
    });
    return {
      ok: true,
      confirmedBy,
      voyage: {
        id: updated.id,
        voyageNo: updated.voyageNo,
        status: updated.status,
        departedAt: updated.departedAt,
        vesselName: updated.vessel.name,
      },
      headcount: dash.total,
    };
  }
}
