import { Body, Controller, Param, Post } from '@nestjs/common';
import { VoyageService } from './voyage.service';

@Controller('members')
export class MembersController {
  constructor(private svc: VoyageService) {}

  /** 证件遗失：暂停通行 */
  @Post(':id/suspend')
  suspend(@Param('id') id: string, @Body() body: any) {
    return this.svc.setMemberStatus(id, 'suspend', body?.note);
  }

  /** 状态处理完成（证件找回/补办）：恢复通行 */
  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() body: any) {
    return this.svc.setMemberStatus(id, 'resolve', body?.note);
  }
}
