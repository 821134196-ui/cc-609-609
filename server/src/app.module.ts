import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { VoyageService } from './voyage.service';
import { ScanService } from './scan.service';
import { VoyagesController } from './voyages.controller';
import { ScanController } from './scan.controller';
import { MembersController } from './members.controller';

@Module({
  controllers: [VoyagesController, ScanController, MembersController],
  providers: [PrismaService, VoyageService, ScanService],
})
export class AppModule {}
