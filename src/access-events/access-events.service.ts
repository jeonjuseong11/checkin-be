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

// 배치 수집 결과: 건별 결과 + 집계(부분 성공)
export interface BatchIngestResult {
  total: number;
  accepted: number;
  duplicate: number;
  results: IngestResult[];
}

// occurred_at이 수신 시점보다 이만큼 과거면 "지각 도착"으로 표시(아키텍처 §4.4)
const LATE_ARRIVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7일

@Injectable()
export class AccessEventsService {
  constructor(
    @InjectRepository(AccessEventEntity) // access_events 테이블에 접근할 레포지토리 주입
    private readonly accessEventsRepository: Repository<AccessEventEntity>,
  ) {}

  // DTO → DB 행(저장용 값 객체)로 변환. 단일/배치가 공유한다.
  // occurredAt string→Date, clientEventSeq number→string(bigint), lateArrival 계산.
  private toRow(clientId: string, dto: IngestAccessEventDto, receivedAt: Date) {
    const occurredAt = new Date(dto.occurredAt);
    return {
      clientId,
      eventId: dto.eventId,
      deviceId: dto.deviceId,
      gateId: dto.gateId,
      subjectId: dto.subjectId,
      direction: dto.direction,
      decision: dto.decision,
      occurredAt,
      receivedAt,
      clientEventSeq: String(dto.clientEventSeq),
      lateArrival:
        receivedAt.getTime() - occurredAt.getTime() > LATE_ARRIVAL_MS,
    };
  }

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
      .values(this.toRow(clientId, dto, new Date()))
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

  // 배치 수집 — 부분 성공(아키텍처 §4.4). 일부 신규/일부 중복이어도 건별 결과를 돌려준다.
  async ingestMany(
    clientId: string,
    events: IngestAccessEventDto[],
  ): Promise<BatchIngestResult> {
    // 1) 단말 시퀀스 오름차순 정렬(단말에서 발생한 시간순 보장).
    const sorted = [...events].sort(
      (a, b) => a.clientEventSeq - b.clientEventSeq,
    );

    const receivedAt = new Date();
    const rows = sorted.map((dto) => this.toRow(clientId, dto, receivedAt));

    // 2) 다건을 한 번의 INSERT로. ON CONFLICT DO NOTHING이라 이미 있던 이벤트는 건너뛴다.
    //    RETURNING에는 "실제로 새로 들어간" 행의 event_id만 돌아온다.
    const result = await this.accessEventsRepository
      .createQueryBuilder()
      .insert()
      .values(rows)
      .orIgnore()
      .returning('event_id')
      .execute();

    // 3) RETURNING된 event_id 집합 → 그 안에 있으면 accepted, 없으면 duplicate.
    const acceptedIds = new Set<string>(
      (result.raw as { event_id: string }[]).map((r) => r.event_id),
    );

    const results: IngestResult[] = sorted.map((dto) => ({
      eventId: dto.eventId,
      status: acceptedIds.has(dto.eventId) ? 'accepted' : 'duplicate',
    }));

    const accepted = acceptedIds.size;
    return {
      total: results.length,
      accepted,
      duplicate: results.length - accepted,
      results,
    };
  }
}
