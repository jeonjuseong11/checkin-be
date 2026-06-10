import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessEventEntity } from './entities/access-event.entity';
import { IngestAccessEventDto } from './dto/ingest-access-event.dto';

// 수집 결과: 새로 저장됐는지(accepted) 이미 있던 중복인지(duplicate)
export interface IngestResult {
  eventId: string;
  status: 'accepted' | 'duplicate';
}

@Injectable()
export class AccessEventsService {
  constructor(
    @InjectRepository(AccessEventEntity) // access_events 테이블에 접근할 레포지토리 주입
    private readonly accessEventsRepository: Repository<AccessEventEntity>,
  ) {}

  // 단일 출입 이벤트 수집. clientId는 호출자(5단계 ApiKeyGuard)가 책임지고 넘긴다.
  async ingestOne(
    clientId: string,
    dto: IngestAccessEventDto,
  ): Promise<IngestResult> {
    // INSERT ... ON CONFLICT (client_id, event_id) DO NOTHING RETURNING ...
    // .orIgnore()가 ON CONFLICT DO NOTHING을 만든다. UNIQUE 제약(2단계)에 걸리면 조용히 무시.
    const result = await this.accessEventsRepository
      .createQueryBuilder()
      .insert()
      .values({
        clientId,
        eventId: dto.eventId,
        deviceId: dto.deviceId,
        gateId: dto.gateId,
        subjectId: dto.subjectId,
        direction: dto.direction,
        decision: dto.decision,
        // JSON 문자열 → Date (timestamptz 컬럼), number → string (bigint 컬럼)
        occurredAt: new Date(dto.occurredAt),
        receivedAt: new Date(), // 서버 수신 시각
        clientEventSeq: String(dto.clientEventSeq),
      })
      .orIgnore()
      .returning(['id']) // 실제로 INSERT된 행만 돌아온다(충돌이면 빈 배열)
      .execute();

    // RETURNING에 행이 있으면 신규 저장, 없으면 이미 존재하던 중복.
    // 폴링/Redis가 꼬여도 'DB가 진실' — 실제 INSERT 여부로 판정(아키텍처 §4.3).
    const inserted = result.raw.length > 0;
    return {
      eventId: dto.eventId,
      status: inserted ? 'accepted' : 'duplicate',
    };
  }
}
