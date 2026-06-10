// src/access-events/dto/ingest-batch.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { IngestAccessEventDto } from './ingest-access-event.dto';

// 음영(오프라인) 복구 시 쌓인 이벤트 여러 건을 한 번에 올리는 입력 계약.
export class IngestBatchDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'events는 1건 이상이어야 합니다.' })
  @ArrayMaxSize(500, { message: '한 번에 최대 500건까지 가능합니다.' }) // 과도한 페이로드 방어
  // @ValidateNested + @Type 조합: 배열의 각 원소를 IngestAccessEventDto로 "변환 후" 검증한다.
  //   @Type이 없으면 원소가 평범한 Object로 남아 @IsUUID 등의 규칙이 적용되지 않는다.
  @ValidateNested({ each: true })
  @Type(() => IngestAccessEventDto)
  events: IngestAccessEventDto[];
}
