import {
  Controller,
  Post,
  Body,
  Headers,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AccessEventsService } from './access-events.service';
import { IngestAccessEventDto } from './dto/ingest-access-event.dto';

@Controller('access-events') // 모든 라우트 앞에 /access-events
export class AccessEventsController {
  constructor(private readonly accessEventsService: AccessEventsService) {}

  // POST /access-events — 단일 출입 이벤트 수집
  @Post()
  @HttpCode(HttpStatus.CREATED) // 4단계에선 accepted/duplicate 모두 201. 200/201 구분은 6단계 인터셉터에서.
  async ingestOne(
    // ⚠️ 임시: 5단계 ApiKeyGuard 도입 시 인증 컨텍스트에서 clientId를 주입하도록 교체한다.
    //    @Headers()는 @Body/@Param과 달리 파이프 인자를 못 받으므로 여기서 직접 검증한다.
    @Headers('x-client-id') clientId: string,
    @Body() dto: IngestAccessEventDto, // 전역 ValidationPipe가 이미 검증한 깨끗한 DTO
  ) {
    if (!clientId || !isUUID(clientId)) {
      throw new BadRequestException('X-Client-Id 헤더(UUID)가 필요합니다.');
    }
    return this.accessEventsService.ingestOne(clientId, dto);
  }
}
