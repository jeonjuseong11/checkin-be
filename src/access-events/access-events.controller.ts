import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AccessEventsService } from './access-events.service';
import { IngestAccessEventDto } from './dto/ingest-access-event.dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentClient } from '../auth/current-client.decorator';

@Controller('access-events') // 모든 라우트 앞에 /access-events
@UseGuards(ApiKeyGuard) // 이 컨트롤러의 모든 라우트는 API 키 인증을 통과해야 한다
export class AccessEventsController {
  constructor(private readonly accessEventsService: AccessEventsService) {}

  // POST /access-events — 단일 출입 이벤트 수집
  @Post()
  @HttpCode(HttpStatus.CREATED) // accepted/duplicate 모두 201. 200/201 구분은 6단계 인터셉터에서.
  async ingestOne(
    // clientId는 더 이상 헤더에서 받지 않는다 — 가드가 인증한 고객사에서 주입.
    @CurrentClient('id') clientId: string,
    @Body() dto: IngestAccessEventDto, // 전역 ValidationPipe가 이미 검증한 깨끗한 DTO
  ) {
    return this.accessEventsService.ingestOne(clientId, dto);
  }
}
