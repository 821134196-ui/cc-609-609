import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface ScanResultView {
  eventNo: string;
  result: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE' | 'INVALID';
  originalResult?: string | null;
  reason: string | null;
  event?: unknown;
}

/**
 * 扫码登记（本地模拟接口）。
 * - eventNo 由扫码端生成，全局唯一：同一事件号重复提交（离线补传、重复扫码）
 *   返回 DUPLICATE 且不新建记录，保证幂等；
 * - 权限按「当前生效名单」校验：换班后旧名单人员一律 NO_PERMISSION；
 * - 证件遗失被暂停的船员 MEMBER_SUSPENDED；航次离港后 VOYAGE_CLOSED。
 */
@Injectable()
export class ScanService {
  constructor(private prisma: PrismaService) {}

  async scan(dto: any, defaultSource = 'GATE'): Promise<ScanResultView> {
    const eventNo = String(dto?.eventNo ?? '').trim();
    if (!eventNo) throw new BadRequestException('eventNo（事件号）必填');
    const voyageId = String(dto?.voyageId ?? '').trim();
    if (!voyageId) throw new BadRequestException('voyageId 必填');
    const docNo = String(dto?.docNo ?? '').trim();
    if (!docNo) throw new BadRequestException('docNo（证件号）必填');
    if (dto?.direction !== 'ASHORE' && dto?.direction !== 'RETURN') {
      throw new BadRequestException('direction 必须为 ASHORE（登岸）或 RETURN（返船）');
    }
    const occurredAt = new Date(dto?.occurredAt);
    if (!dto?.occurredAt || isNaN(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt（事件发生时间）无效');
    }
    const source =
      typeof dto?.source === 'string' && dto.source.trim() ? dto.source.trim() : defaultSource;

    // 幂等：事件号已存在 → 直接返回首次处理结果
    const existing = await this.prisma.passEvent.findUnique({ where: { eventNo } });
    if (existing) {
      return {
        eventNo,
        result: 'DUPLICATE',
        originalResult: existing.result,
        reason: existing.reason,
        event: existing,
      };
    }

    let result: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED';
    let reason: string | null = null;
    let memberId: string | null = null;

    const voyage = await this.prisma.voyage.findUnique({
      where: { id: voyageId },
      include: { lists: { where: { status: 'ACTIVE' }, include: { members: true } } },
    });
    if (!voyage) {
      result = 'REJECTED';
      reason = 'VOYAGE_NOT_FOUND';
    } else if (voyage.status !== 'OPEN') {
      result = 'REJECTED';
      reason = 'VOYAGE_CLOSED';
    } else {
      const member = voyage.lists[0]?.members.find((m) => m.docNo === docNo);
      if (!member) {
        result = 'REJECTED';
        reason = 'NO_PERMISSION'; // 不在生效名单上（含换班后被换下的人员）
      } else if (member.status === 'SUSPENDED') {
        result = 'REJECTED';
        reason = 'MEMBER_SUSPENDED';
        memberId = member.id;
      } else {
        memberId = member.id;
      }
    }

    try {
      const event = await this.prisma.passEvent.create({
        data: {
          eventNo,
          voyageId,
          memberId,
          docNo,
          direction: dto.direction,
          source,
          result,
          reason,
          occurredAt,
        },
      });
      return { eventNo, result, reason, event };
    } catch (e: any) {
      // 并发下同事件号撞唯一约束 → 按重复处理
      if (e?.code === 'P2002') {
        const ev = await this.prisma.passEvent.findUnique({ where: { eventNo } });
        return {
          eventNo,
          result: 'DUPLICATE',
          originalResult: ev?.result ?? null,
          reason: ev?.reason ?? null,
          event: ev ?? undefined,
        };
      }
      throw e;
    }
  }

  /** 离线补传：逐条独立处理，单条失败不影响其他记录（晚返船记录不丢） */
  async batch(items: any[]) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('批量事件不能为空');
    }
    if (items.length > 500) throw new BadRequestException('单次批量补传不能超过 500 条');
    const results: ScanResultView[] = [];
    for (const item of items) {
      try {
        results.push(await this.scan(item, 'OFFLINE_SYNC'));
      } catch (e: any) {
        results.push({
          eventNo: String(item?.eventNo ?? ''),
          result: 'INVALID',
          reason: e?.message ?? 'invalid',
        });
      }
    }
    return { results };
  }
}
