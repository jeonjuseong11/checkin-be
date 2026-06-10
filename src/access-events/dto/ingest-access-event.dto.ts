// src/access-events/dto/ingest-access-event.dto.ts
import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsIn,
  IsISO8601,
  IsInt,
  Min,
} from 'class-validator';

// 단말(기기)이 출입 이벤트 1건을 올릴 때 보내는 "입력 계약".
// ❗ 엔티티가 아니라 입력 명세다 — 서버가 채우는 id / clientId / receivedAt /
//    lateArrival / createdAt 은 여기 넣지 않는다. 단말이 마음대로 정할 값이 아니므로.
export class IngestAccessEventDto {
  @IsUUID('4', { message: 'eventId는 UUID 형식이어야 합니다.' })
  eventId: string; // 단말이 생성하는 멱등 키. (client_id, event_id)로 중복 차단.

  @IsString()
  @IsNotEmpty({ message: 'deviceId는 필수입니다.' })
  deviceId: string;

  @IsString()
  @IsNotEmpty({ message: 'gateId는 필수입니다.' })
  gateId: string;

  @IsString()
  @IsNotEmpty({ message: 'subjectId는 필수입니다.' })
  subjectId: string;

  // @IsIn: 허용된 값 목록(화이트리스트) 밖이면 거부. "왼쪽" 같은 쓰레기 값 차단.
  @IsIn(['IN', 'OUT'], { message: 'direction은 IN 또는 OUT만 가능합니다.' })
  direction: 'IN' | 'OUT';

  @IsIn(['GRANTED', 'DENIED'], {
    message: 'decision은 GRANTED 또는 DENIED만 가능합니다.',
  })
  decision: 'GRANTED' | 'DENIED';

  // JSON엔 Date 타입이 없으므로 ISO 8601 문자열로 받는다(예: "2026-06-10T11:39:00Z").
  // DB 저장(4단계)에서 Date로 변환해 timestamptz 컬럼에 넣는다.
  @IsISO8601(
    {},
    { message: 'occurredAt은 ISO8601 형식(예: 2026-06-10T11:39:00Z)이어야 합니다.' },
  )
  occurredAt: string;

  // 단말이 매기는 단조 증가 시퀀스. 입력은 정수로 받고,
  // 엔티티 저장 시 bigint(=string) 컬럼으로 변환한다(JS number 정밀도 한계 때문).
  @IsInt({ message: 'clientEventSeq는 정수여야 합니다.' })
  @Min(0)
  clientEventSeq: number;
}
