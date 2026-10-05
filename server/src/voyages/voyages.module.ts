import { Module } from '@nestjs/common';
import { VoyagesController } from './voyages.controller';
import { VoyagesService } from './voyages.service';

@Module({
  controllers: [VoyagesController],
  providers: [VoyagesService],
  exports: [VoyagesService],
})
export class VoyagesModule {}
