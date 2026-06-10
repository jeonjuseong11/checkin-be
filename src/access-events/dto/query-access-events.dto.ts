// src/access-events/dto/query-access-events.dto.ts
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsIn,
  IsISO8601,
  IsInt,
  Min,
  Max,
} from 'class-validator';

// GET /access-events 의 쿼리 파라미터 계약(감사 조회).
// 쿼리스트링은 전부 string으로 들어오므로, 숫자(limit)는 @Type(() => Number)로 변환한다.
// 모든 필드 @IsOptional — 필터 없이 부르면 최신순 전체를 페이지 단위로 훑는다.
export class QueryAccessEventsDto {
  // 기간 필터(occurredAt 기준). ISO8601 문자열로 받아 서비스에서 Date로 변환.
  @IsOptional()
  @IsISO8601({}, { message: 'from은 ISO8601 형식이어야 합니다.' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to는 ISO8601 형식이어야 합니다.' })
  to?: string;

  // 게이트 필터 — idx_access_event_gate (client_id, gate_id, occurred_at)가 받친다.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  gateId?: string;

  // 출입 주체(직원/방문자) 필터.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subjectId?: string;

  @IsOptional()
  @IsIn(['IN', 'OUT'], { message: 'direction은 IN 또는 OUT만 가능합니다.' })
  direction?: 'IN' | 'OUT';

  // 페이지 크기. 기본 50(서비스에서 적용), 무한정 페이로드 방어로 최대 200 상한.
  @IsOptional()
  @Type(() => Number) // 쿼리스트링 "50" → number 50 변환(@IsInt 통과시키기)
  @IsInt({ message: 'limit은 정수여야 합니다.' })
  @Min(1)
  @Max(200, { message: 'limit은 최대 200까지 가능합니다.' })
  limit?: number;

  // 다음 페이지 커서(이전 응답의 nextCursor를 그대로 다시 보냄). 불투명 문자열.
  @IsOptional()
  @IsString()
  cursor?: string;
}
