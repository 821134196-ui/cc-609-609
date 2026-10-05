import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PersonsService } from './persons.service';

@Controller('api/persons')
export class PersonsController {
  constructor(private persons: PersonsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.persons.list(status);
  }

  @Post('suspend')
  suspend(@Body() body: { certNo: string; note?: string }) {
    return this.persons.suspend(body.certNo, body.note);
  }

  @Post('resume')
  resume(@Body() body: { certNo: string; note?: string }) {
    return this.persons.resume(body.certNo, body.note);
  }
}
