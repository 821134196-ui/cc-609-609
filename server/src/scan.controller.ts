import { Body, Controller, Post } from '@nestjs/common';
import { ScanService } from './scan.service';

@Controller('scan')
export class ScanController {
  constructor(private svc: ScanService) {}

  /** 船梯口扫码登记（本地模拟） */
  @Post()
  scan(@Body() body: any) {
    return this.svc.scan(body);
  }

  /** 离线补传（批量，按事件号去重） */
  @Post('batch')
  batch(@Body() body: any) {
    return this.svc.batch(body?.events);
  }
}
