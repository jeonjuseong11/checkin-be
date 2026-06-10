import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AccessEventsService } from './access-events.service';
import { IngestAccessEventDto } from './dto/ingest-access-event.dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentClient } from '../auth/current-client.decorator';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Controller('access-events') // 모든 라우트 앞에 /access-events
@UseGuards(ApiKeyGuard) // 이 컨트롤러의 모든 라우트는 API 키 인증을 통과해야 한다
export class AccessEventsController {
  constructor(private readonly accessEventsService: AccessEventsService) {}

  // POST /access-events — 단일 출입 이벤트 수집
  @Post()
  @UseInterceptors(IdempotencyInterceptor) // 계층 A 멱등: 동일 요청은 핸들러 미실행·캐시 응답
  @HttpCode(HttpStatus.CREATED)
  async ingestOne(
    // clientId는 더 이상 헤더에서 받지 않는다 — 가드가 인증한 고객사에서 주입.
    @CurrentClient('id') clientId: string,
    @Body() dto: IngestAccessEventDto, // 전역 ValidationPipe가 이미 검증한 깨끗한 DTO
  ) {
    return this.accessEventsService.ingestOne(clientId, dto);
  }
}
