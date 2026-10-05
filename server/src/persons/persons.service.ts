import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PersonsService {
  constructor(private prisma: PrismaService) {}

  async list(status?: string) {
    const persons = await this.prisma.person.findMany({
      where: status ? { status } : {},
      orderBy: { id: 'asc' },
    });
    return persons.map((p) => ({
      id: p.id,
      name: p.name,
      certNo: p.certNo,
      certLast4: p.certLast4,
      photo: p.photo,
      status: p.status,
      statusNote: p.statusNote,
    }));
  }

  /** 证件遗失：暂停通行，直到状态处理（恢复或换发） */
  async suspend(certNo: string, note?: string) {
    const person = await this.prisma.person.findUnique({ where: { certNo } });
    if (!person) throw new NotFoundException('证件持有人不存在');
    const updated = await this.prisma.person.update({
      where: { id: person.id },
      data: { status: 'SUSPENDED', statusNote: note ?? '证件遗失，暂停通行' },
    });
    return {
      ok: true,
      certNo: updated.certNo,
      status: updated.status,
      statusNote: updated.statusNote,
    };
  }

  async resume(certNo: string, note?: string) {
    const person = await this.prisma.person.findUnique({ where: { certNo } });
    if (!person) throw new NotFoundException('证件持有人不存在');
    if (person.status === 'ACTIVE')
      throw new BadRequestException('该证件当前并非暂停状态');
    const updated = await this.prisma.person.update({
      where: { id: person.id },
      data: { status: 'ACTIVE', statusNote: note ?? '状态已处理，恢复通行' },
    });
    return {
      ok: true,
      certNo: updated.certNo,
      status: updated.status,
      statusNote: updated.statusNote,
    };
  }
}
