// src/access-events/dto/export-access-events.dto.ts
import { AccessEventFilterDto } from './access-event-filter.dto';

// GET /access-events/export 의 쿼리 파라미터 계약.
// 내보내기는 "필터에 맞는 전체"를 스트리밍하므로 페이지네이션이 없다 — 베이스 필터만 그대로 쓴다.
// (limit/cursor를 보내면 전역 ValidationPipe의 forbidNonWhitelisted가 400으로 거부.)
export class ExportAccessEventsDto extends AccessEventFilterDto {}
