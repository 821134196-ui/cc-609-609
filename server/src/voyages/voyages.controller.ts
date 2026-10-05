import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { VoyagesService, ManifestMemberDto } from './voyages.service';

@Controller('api')
export class VoyagesController {
  constructor(private voyages: VoyagesService) {}

  @Get('voyages')
  list() {
    return this.voyages.listVoyages();
  }

  @Get('voyages/current')
  current() {
    return this.voyages.currentOpenVoyage();
  }

  @Get('voyages/:id/dashboard')
  dashboard(@Param('id', ParseIntPipe) id: number) {
    return this.voyages.dashboard(id);
  }

  @Get('dashboard')
  currentDashboard() {
    return this.voyages.dashboard();
  }

  @Get('voyages/:id/versions')
  versions(@Param('id', ParseIntPipe) id: number) {
    return this.voyages.listVersions(id);
  }

  @Post('manifests')
  submit(
    @Body()
    body: {
      voyageNo: string;
      vesselName?: string;
      imo?: string;
      submittedBy: string;
      note?: string;
      members: ManifestMemberDto[];
    },
  ) {
    return this.voyages.submitManifest(body);
  }

  @Post('scan')
  scan(
    @Body()
    body: {
      eventId: string;
      certNo: string;
      direction: 'DISEMBARK' | 'EMBARK';
      voyageId?: number;
      scannedAt?: string;
    },
  ) {
    return this.voyages.scan(body);
  }

  @Post('sync')
  sync(
    @Body()
    body: {
      voyageId?: number;
      batchId?: string;
      events: {
        eventId: string;
        certNo: string;
        direction: 'DISEMBARK' | 'EMBARK';
        scannedAt: string;
      }[];
    },
  ) {
    return this.voyages.syncBatch(body);
  }

  @Post('voyages/:id/depart')
  depart(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { confirmedBy?: string },
  ) {
    return this.voyages.confirmDeparture(id, body.confirmedBy ?? '船长');
  }
}
