import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { VoyageService } from './voyage.service';

@Controller()
export class VoyagesController {
  constructor(private svc: VoyageService) {}

  @Post('voyages')
  createVoyage(@Body() body: any) {
    return this.svc.createVoyage(body);
  }

  @Get('voyages')
  listVoyages() {
    return this.svc.listVoyages();
  }

  /** 代理提交本航次名单（每次提交生成新版本，用于临时换班） */
  @Post('voyages/:id/lists')
  submitList(@Param('id') id: string, @Body() body: any) {
    return this.svc.submitList(id, body);
  }

  /** 名单变更历史（可查询） */
  @Get('voyages/:id/lists')
  getLists(@Param('id') id: string) {
    return this.svc.getLists(id);
  }

  @Get('voyages/:id/lists/:version')
  getListMembers(@Param('id') id: string, @Param('version') version: string) {
    return this.svc.getListMembers(id, Number(version));
  }

  /** 值守状态板：生效名单 + 每人当前在船/登岸状态 + 未返船名单 */
  @Get('voyages/:id/status')
  getStatus(@Param('id') id: string) {
    return this.svc.getStatus(id);
  }

  /** 通行记录查询 */
  @Get('voyages/:id/events')
  getEvents(@Param('id') id: string, @Query() q: any) {
    return this.svc.getEvents(id, q);
  }

  /** 船长离港确认 */
  @Post('voyages/:id/confirm-departure')
  confirmDeparture(@Param('id') id: string, @Body() body: any) {
    return this.svc.confirmDeparture(id, body?.confirmedBy);
  }

  @Get('voyages/:id/confirmations')
  getConfirmations(@Param('id') id: string) {
    return this.svc.getConfirmations(id);
  }
}
