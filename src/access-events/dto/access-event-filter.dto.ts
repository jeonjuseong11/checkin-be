// src/access-events/dto/access-event-filter.dto.ts
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsIn,
  IsISO8601,
} from 'class-validator';

// 조회/내보내기가 공유하는 필터 필드. 페이지네이션(limit/cursor)은 여기 없다 —
// 조회는 여기에 limit/cursor를 더하고, 내보내기는 필터만 그대로 쓴다.
export class AccessEventFilterDto {
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
}
