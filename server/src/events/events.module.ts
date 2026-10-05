import { Controller, Get, Module, Query } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/events')
class EventsController {
  constructor(private prisma: PrismaService) {}

  /** 通行记录查询：可按航次、人员证件号、方向、来源过滤 */
  @Get()
  async list(
    @Query('voyageId') voyageId?: string,
    @Query('certNo') certNo?: string,
    @Query('direction') direction?: string,
    @Query('source') source?: string,
  ) {
    const where: any = {};
    if (voyageId) where.voyageId = Number(voyageId);
    if (direction) where.direction = direction;
    if (source) where.source = source;
    if (certNo) where.person = { certNo: { contains: certNo } };

    const events = await this.prisma.accessEvent.findMany({
      where,
      orderBy: [{ scannedAt: 'desc' }, { id: 'desc' }],
      include: { person: true, voyage: { include: { vessel: true } } },
    });
    return events.map((e) => ({
      id: e.id,
      eventId: e.eventId,
      voyageId: e.voyageId,
      voyageNo: e.voyage.voyageNo,
      vesselName: e.voyage.vessel.name,
      personId: e.personId,
      name: e.person.name,
      certNo: e.person.certNo,
      certLast4: e.person.certLast4,
      direction: e.direction,
      scannedAt: e.scannedAt,
      receivedAt: e.receivedAt,
      source: e.source,
      batchId: e.batchId,
    }));
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [EventsController],
})
export class EventsModule {}
