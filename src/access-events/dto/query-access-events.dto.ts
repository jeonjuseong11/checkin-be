// src/access-events/dto/query-access-events.dto.ts
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { AccessEventFilterDto } from './access-event-filter.dto';

// GET /access-events 의 쿼리 파라미터 계약(감사 조회).
// 공통 필터(from/to/gateId/subjectId/direction)는 베이스에서 상속, 여기선 페이지네이션만 추가.
export class QueryAccessEventsDto extends AccessEventFilterDto {
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
