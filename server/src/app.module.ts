import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { VoyagesModule } from './voyages/voyages.module';
import { PersonsModule } from './persons/persons.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [PrismaModule, VoyagesModule, PersonsModule, EventsModule],
})
export class AppModule {}
