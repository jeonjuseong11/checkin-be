import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Readable } from 'node:stream';
import { AccessEventEntity } from './entities/access-event.entity';
import { IngestAccessEventDto } from './dto/ingest-access-event.dto';
import { AccessEventFilterDto } from './dto/access-event-filter.dto';
import { QueryAccessEventsDto } from './dto/query-access-events.dto';
import { ExportAccessEventsDto } from './dto/export-access-events.dto';
import {
  AccessEventItemDto,
  AccessEventsPageDto,
} from './dto/access-events-page.dto';

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

// 조회 기본 페이지 크기(쿼리에 limit 없을 때). 상한 200은 DTO의 @Max가 강제.
const DEFAULT_PAGE_LIMIT = 50;

// keyset 커서 = (occurredAt, id)를 base64url로 감싼 불투명 문자열.
// 클라이언트는 내부 구조를 몰라도 되고, 받은 nextCursor를 그대로 되돌려주기만 하면 된다.
interface Cursor {
  occurredAt: string; // ISO8601
  id: string; // 동률(같은 occurredAt) 타이브레이커
}

function encodeCursor(e: AccessEventEntity): string {
  const raw = `${e.occurredAt.toISOString()}|${e.id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Cursor {
  // 망가진/위조된 커서는 400으로 거부(서버가 깨지지 않게).
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.lastIndexOf('|'); // id(uuid)엔 '|'가 없으므로 마지막 구분자가 경계
  if (sep === -1) {
    throw new BadRequestException('유효하지 않은 cursor입니다.');
  }
  const occurredAt = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!occurredAt || !id || Number.isNaN(Date.parse(occurredAt))) {
    throw new BadRequestException('유효하지 않은 cursor입니다.');
  }
  return { occurredAt, id };
}

// ── CSV 내보내기 유틸 ──────────────────────────────────────────────
// 엑셀이 UTF-8로 읽도록 BOM을 맨 앞에 붙인다(없으면 한글이 깨짐).
const CSV_BOM = '﻿';
// 엑셀 친화적으로 줄바꿈은 CRLF.
const CSV_EOL = '\r\n';
// 내보낼 컬럼 헤더(한글). 아래 rawToCsvRow의 값 순서와 1:1로 맞춘다.
const CSV_HEADER = [
  '발생시각',
  '게이트',
  '대상',
  '방향',
  '판정',
  '이벤트ID',
  '단말ID',
  '수신시각',
  '시퀀스',
  '지각도착',
].join(',');

// 한 필드를 CSV 규칙대로 이스케이프: 쉼표/따옴표/줄바꿈이 있으면 큰따옴표로 감싸고 내부 따옴표는 중복.
function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// timestamptz는 드라이버가 Date로 주므로 ISO로 통일(엑셀에서 정렬·가독성).
function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

// 스트림 raw 한 행 → CSV 한 줄. select 별칭(occurredAt 등)을 그대로 읽는다.
function rawToCsvRow(r: Record<string, unknown>): string {
  return [
    toIso(r.occurredAt),
    r.gateId,
    r.subjectId,
    r.direction,
    r.decision,
    r.eventId,
    r.deviceId,
    toIso(r.receivedAt),
    r.clientEventSeq,
    r.lateArrival,
  ]
    .map(csvEscape)
    .join(',');
}

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

  // 출입 이벤트 조회(감사) — keyset 페이지네이션 + 기간/게이트/주체/방향 필터.
  // 항상 client_id로 먼저 좁혀(테넌트 격리) idx_access_event_occurred를 탄다.
  async findMany(
    clientId: string,
    query: QueryAccessEventsDto,
  ): Promise<AccessEventsPageDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    // 별칭 e. createQueryBuilder('e')의 'e.프로퍼티'는 실제 컬럼명으로 매핑된다.
    // 테넌트 격리 + 공통 필터(조회/내보내기 공유)를 헬퍼로 적용.
    const qb = this.scopedQuery(clientId, query);

    // keyset 조건: 커서보다 "과거"부터(정렬이 DESC라 다음 페이지=더 오래된 것).
    // row-value 비교 대신 펼친 형태 — 타입 추론도 안전하고 의도가 명확하다.
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      qb.andWhere(
        '(e.occurredAt < :cts OR (e.occurredAt = :cts AND e.id < :cid))',
        { cts: new Date(c.occurredAt), cid: c.id },
      );
    }

    // 최신 우선 정렬 + 동률 타이브레이커. limit+1로 "다음 페이지 존재 여부"를 본다.
    const rows = await qb
      .orderBy('e.occurredAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(limit + 1)
      .getMany();

    // limit을 초과해 1건 더 왔다면 다음 페이지가 있다는 뜻 → 그 1건은 잘라낸다.
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map((e) => AccessEventItemDto.fromEntity(e)),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      hasMore,
    };
  }

  // 테넌트 격리(client_id) + 공통 필터를 적용한 베이스 쿼리. 조회/내보내기가 공유한다.
  private scopedQuery(
    clientId: string,
    filter: AccessEventFilterDto,
  ): SelectQueryBuilder<AccessEventEntity> {
    const qb = this.accessEventsRepository
      .createQueryBuilder('e')
      .where('e.clientId = :clientId', { clientId }); // 필수: 인덱스 선두 컬럼

    // 들어온 필터만 andWhere로 누적.
    if (filter.from) {
      qb.andWhere('e.occurredAt >= :from', { from: new Date(filter.from) });
    }
    if (filter.to) {
      qb.andWhere('e.occurredAt <= :to', { to: new Date(filter.to) });
    }
    if (filter.gateId) {
      qb.andWhere('e.gateId = :gateId', { gateId: filter.gateId });
    }
    if (filter.subjectId) {
      qb.andWhere('e.subjectId = :subjectId', { subjectId: filter.subjectId });
    }
    if (filter.direction) {
      qb.andWhere('e.direction = :direction', { direction: filter.direction });
    }
    return qb;
  }

  // 필터에 맞는 전체 출입 이벤트를 CSV로 스트리밍(페이지네이션 없음).
  // 전부 메모리에 올리지 않고 DB 커서 스트림 → CSV 줄 변환을 흘려보낸다(대용량 안전).
  streamExportCsv(clientId: string, filter: ExportAccessEventsDto): Readable {
    const qb = this.scopedQuery(clientId, filter)
      // 필요한 컬럼만 별칭으로 선택 → raw 스트림 키가 별칭과 1:1(rawToCsvRow가 그대로 읽음).
      .select('e.occurredAt', 'occurredAt')
      .addSelect('e.gateId', 'gateId')
      .addSelect('e.subjectId', 'subjectId')
      .addSelect('e.direction', 'direction')
      .addSelect('e.decision', 'decision')
      .addSelect('e.eventId', 'eventId')
      .addSelect('e.deviceId', 'deviceId')
      .addSelect('e.receivedAt', 'receivedAt')
      .addSelect('e.clientEventSeq', 'clientEventSeq')
      .addSelect('e.lateArrival', 'lateArrival')
      .orderBy('e.occurredAt', 'DESC')
      .addOrderBy('e.id', 'DESC');

    // async generator: BOM+헤더 → 행들을 순서대로 흘린다. 0건이어도 헤더는 나간다.
    // Readable.from이 백프레셔를 처리하므로 큰 결과도 메모리 폭발 없이 전송된다.
    async function* csvRows() {
      yield CSV_BOM + CSV_HEADER + CSV_EOL;
      const stream = await qb.stream();
      for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
        yield rawToCsvRow(raw) + CSV_EOL;
      }
    }

    return Readable.from(csvRows());
  }
}
