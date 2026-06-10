import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AccessEventsService } from './access-events.service';
import { IngestAccessEventDto } from './dto/ingest-access-event.dto';
import { IngestBatchDto } from './dto/ingest-batch.dto';
import { QueryAccessEventsDto } from './dto/query-access-events.dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentClient } from '../auth/current-client.decorator';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Controller('access-events') // 모든 라우트 앞에 /access-events
@UseGuards(ApiKeyGuard) // 이 컨트롤러의 모든 라우트는 API 키 인증을 통과해야 한다
export class AccessEventsController {
  constructor(private readonly accessEventsService: AccessEventsService) {}

  // GET /access-events — 출입 이벤트 조회(감사). keyset 페이지네이션 + 기간/게이트/주체/방향 필터.
  // 인증된 본인 테넌트(clientId)로 격리된 결과만 돌려준다.
  @Get()
  async list(
    @CurrentClient('id') clientId: string,
    @Query() query: QueryAccessEventsDto, // 전역 ValidationPipe가 쿼리 파라미터 검증·변환
  ) {
    return this.accessEventsService.findMany(clientId, query);
  }

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

  // POST /access-events/batch — 음영 복구 배치 수집(부분 성공)
  // 멱등 인터셉터를 걸지 않는다: 배치는 "이벤트 단위" 멱등(계층 B=서비스/DB)이 핵심(§4.2).
  @Post('batch')
  @HttpCode(HttpStatus.OK) // 건별 결과를 담은 200 — 전체 성공/실패가 아닌 부분 성공 응답
  async ingestBatch(
    @CurrentClient('id') clientId: string,
    @Body() dto: IngestBatchDto,
  ) {
    return this.accessEventsService.ingestMany(clientId, dto.events);
  }
}
