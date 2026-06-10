// src/access-events/dto/access-events-page.dto.ts
import { AccessEventEntity } from '../entities/access-event.entity';

// 응답에 담는 출입 이벤트 1건의 모양.
// clientId는 인증된 본인 테넌트라 중복·내부값이므로 응답에서 제외(테넌트 격리 + 모양 정리).
export class AccessEventItemDto {
  id: string;
  eventId: string;
  deviceId: string;
  gateId: string;
  subjectId: string;
  direction: 'IN' | 'OUT';
  decision: 'GRANTED' | 'DENIED';
  occurredAt: Date;
  receivedAt: Date;
  clientEventSeq: string;
  lateArrival: boolean;
  createdAt: Date;

  // 엔티티 → 응답 항목 변환(필요한 필드만 골라 담는다).
  static fromEntity(e: AccessEventEntity): AccessEventItemDto {
    return {
      id: e.id,
      eventId: e.eventId,
      deviceId: e.deviceId,
      gateId: e.gateId,
      subjectId: e.subjectId,
      direction: e.direction,
      decision: e.decision,
      occurredAt: e.occurredAt,
      receivedAt: e.receivedAt,
      clientEventSeq: e.clientEventSeq,
      lateArrival: e.lateArrival,
      createdAt: e.createdAt,
    };
  }
}

// keyset 페이지 응답: 이번 페이지 항목 + 다음 페이지로 넘어갈 커서 + 더 있는지 여부.
export class AccessEventsPageDto {
  items: AccessEventItemDto[];
  nextCursor: string | null; // 다음 요청에 그대로 cursor로 보냄. 마지막 페이지면 null.
  hasMore: boolean;
}
