# 백엔드 아키텍처 설계서: 하이브리드 출입 통제 시스템

| 항목 | 내용 |
|------|------|
| 문서 버전 | v0.1 (Draft) |
| 작성일 | 2026-06-09 |
| 기반 문서 | [`docs/prd.md`](./prd.md) |
| 코드베이스 | `checkin-be` (NestJS 11 · TypeORM · PostgreSQL) |
| 대상 독자 | 백엔드 엔지니어, 코드 리뷰어 |

> 이 문서는 PRD(`docs/prd.md`)의 4대 필수 스펙(오프라인 큐, Redis 멱등성, 구글 시트 미러링, FCM 하이브리드 알림)을 구현 가능한 아키텍처로 옮긴 것이다. 진실의 원천은 항상 PostgreSQL이고, Redis는 멱등성 키 저장소와 잡 큐 백엔드로만 쓴다.

---

## 1. 기술 스택 결정 (Boring by Default)

혁신 토큰은 아껴 쓴다. 새로운 것은 "오프라인 내성 수집 파이프라인" 하나면 충분하고, 나머지는 검증된 기술로 간다.

| 관심사 | 선택 | 근거 |
|--------|------|------|
| 웹 프레임워크 | NestJS 11 (기존) | 이미 채택. 모듈/DI/인터셉터가 이 설계의 뼈대 |
| ORM | TypeORM (기존) | 기존 `ClientEntity`와 일관. 마이그레이션 기반 스키마 관리 |
| RDB | PostgreSQL (기존) | 원천 데이터. UNIQUE 제약이 멱등성 최종 방어선 |
| 멱등성 키 / 캐시 | Redis | 원자적 `SET NX EX`. 잡 큐와 인프라 공유 |
| 비동기 잡 큐 | BullMQ (Redis 기반) | NestJS 공식 `@nestjs/bullmq` 통합. 재시도/백오프 내장. 별도 브로커 불필요 |
| 시트 연동 | Google Sheets API v4 (`googleapis`) | 표준 클라이언트. 배치 `values.append` |
| 푸시 | Firebase Admin SDK (FCM) | 표준. 토큰 무효화 응답 처리 |

> 신규 인프라는 Redis 하나뿐이다(멱등성 + BullMQ가 공유). Kafka/RabbitMQ 같은 별도 브로커는 현 규모에 과하다. 트래픽이 단일 Redis BullMQ 처리량을 넘어서면 그때 재평가한다.

---

## 2. NestJS 모듈 구조

### 2.1 모듈 의존성 그래프

```
                         ┌──────────────────┐
                         │    AppModule      │
                         │  (ConfigModule,   │
                         │   TypeOrmModule,   │
                         │   BullModule root) │
                         └─────────┬─────────┘
            ┌─────────────┬────────┼────────┬──────────────┐
            ▼             ▼        ▼         ▼              ▼
     ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐ ┌───────────────┐
     │ ClientsMod │ │ AuthMod  │ │ AccessEvent│ │ Notification │ │ SheetSyncMod  │
     │ (기존)      │ │ (Guard,  │ │   Module   │ │   Module     │ │  (mirror)     │
     │ app_clients│ │  ApiKey) │ │ (수집 코어) │ │  (FCM+inbox)  │ │ Google Sheets │
     └─────┬──────┘ └────┬─────┘ └─────┬──────┘ └──────┬───────┘ └──────┬────────┘
           │             │             │                │                │
           └─────────────┴─────►  공유: IdempotencyModule (Redis)  ◄─────┘
                                       │
                                 ┌─────┴──────┐
                                 │  CoreModule │  (RedisModule, BullModule.forFeature,
                                 │  (global)   │   ObservabilityModule: 메트릭/로깅)
                                 └─────────────┘
```

핵심 규칙:
- **`AuthModule`** 는 기존 `app_clients.api_key_hash`(SHA-256) 검증을 `ApiKeyGuard`로 제공한다. 모든 보호 라우트에 전역 가드로 적용한다.
- **`AccessEventModule`** 가 수집 코어다. 시트/알림은 직접 호출하지 않고 **도메인 이벤트 → BullMQ 잡**으로 느슨하게 연결한다(Conway: 팀/책임 경계 = 모듈 경계).
- **`IdempotencyModule`** 는 Redis 클라이언트와 `IdempotencyInterceptor`, `IdempotencyService`를 export 하는 공유 모듈. 수집뿐 아니라 멱등이 필요한 어떤 라우트에서도 재사용한다(DRY).
- **`CoreModule`** 는 `@Global()`. Redis 연결, BullMQ 루트, 메트릭/로깅을 한 곳에서.

### 2.2 디렉토리 구조

```
src/
├── app.module.ts
├── main.ts
├── core/
│   ├── core.module.ts                 # @Global: Redis, BullMQ root, observability
│   ├── redis/redis.provider.ts        # ioredis 단일 연결 + 헬스체크
│   └── observability/metrics.service.ts
├── clients/                           # 기존 (app_clients)
│   ├── entities/client.entity.ts
│   └── ...
├── auth/
│   ├── auth.module.ts
│   └── guards/api-key.guard.ts        # chk_... 검증, SHA-256 대조, is_active 확인
├── idempotency/
│   ├── idempotency.module.ts
│   ├── idempotency.interceptor.ts     # 요청 단위 멱등 (단일/배치-replay)
│   └── idempotency.service.ts         # Redis SET NX EX 원자 연산 래퍼
├── access-events/
│   ├── access-events.module.ts
│   ├── access-events.controller.ts    # POST /v1/access-events(:batch), GET, /occupancy
│   ├── access-events.service.ts       # 이벤트별 멱등 + DB 트랜잭션 + 도메인 이벤트 발행
│   ├── dto/ingest-event.dto.ts        # class-validator
│   ├── dto/ingest-batch.dto.ts
│   ├── entities/access-event.entity.ts
│   └── events/access-event-created.event.ts
├── notifications/
│   ├── notifications.module.ts
│   ├── notifications.processor.ts     # BullMQ 워커: FCM 발송 + inbox 기록
│   ├── notifications.service.ts       # 룰 평가, 멱등 알림 생성
│   └── entities/notification.entity.ts
├── devices/
│   └── entities/device-registration.entity.ts
└── sheet-sync/
    ├── sheet-sync.module.ts
    ├── sheet-sync.processor.ts        # BullMQ 워커: 배칭 append
    ├── sheet-sync.service.ts          # 구글 클라이언트, 레이트리밋
    └── entities/sheet-link.entity.ts
```

---

## 3. 데이터 모델 (ERD)

### 3.1 엔티티 관계도

```
┌──────────────────────────┐
│   app_clients (기존)       │  테넌트 = 격리 단위
│──────────────────────────│
│ PK id              uuid   │
│    name            varchar│
│    email           varchar│
│    api_key_hash    varchar│  ◄── AuthGuard가 SHA-256 대조
│    api_key_preview varchar│
│    is_active       bool   │
│    created_at / updated_at│
└──────────┬───────────────┘
           │ 1
           │
   ┌───────┼───────────────┬───────────────────┬────────────────────┐
   │ N     │ N             │ N                 │ N                  │ N
   ▼       ▼               ▼                   ▼                    ▼
┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ access_events    │ │ device_          │ │ notifications     │ │ sheet_links       │
│                  │ │ registrations    │ │                   │ │                   │
│──────────────────│ │──────────────────│ │───────────────────│ │───────────────────│
│ PK id      uuid  │ │ PK id      uuid  │ │ PK id      uuid   │ │ PK id      uuid   │
│ FK client_id ───┐│ │ FK client_id ───┐│ │ FK client_id ───┐ │ │ FK client_id ──┐  │
│    event_id uuid││ │    device_id     ││ │ FK event_id ────┼─┐│    spreadsheet_id │  │
│    device_id    ││ │    fcm_token     ││ │    type           ││    tab_name       │  │
│    gate_id      ││ │    platform      ││ │    priority        ││    auth_mode      │  │
│    subject_id   ││ │    last_seen_at  ││ │    payload jsonb   ││    last_synced_seq│  │
│    direction    ││ │    is_valid bool ││ │    delivered_push  ││    status         │  │
│    decision     ││ └──────────────────┘ │    read_at         ││    updated_at     │  │
│    occurred_at  ││  UNIQUE(client_id,    │    created_at      ││ └──────────────────┘  │
│    received_at  ││         fcm_token)    │                    ││  UNIQUE(client_id)    │
│    client_event_│└─────────────────────►│ UNIQUE(client_id,  ││  (테넌트당 1 시트, MVP)│
│       seq  bigint│  (선택) 알림→이벤트     │   event_id, type)  │└───────────────────────┘
│    late_arrival  │                       └────────────────────┘
│    created_at    │
│                  │
│ UNIQUE(client_id,│  ◄══════ 멱등성 최종 방어선 (Redis가 죽어도 중복 차단)
│        event_id) │
│ IDX(client_id,   │
│     occurred_at) │
│ IDX(client_id,   │
│     gate_id,     │
│     occurred_at) │
└──────────────────┘
```

### 3.2 관계 요약 (카디널리티)

- `app_clients (1) ── (N) access_events` : 한 테넌트가 다수 출입 이벤트 소유.
- `app_clients (1) ── (N) device_registrations` : 한 테넌트의 단말/관리자 기기들.
- `app_clients (1) ── (N) notifications` : 인앱 인박스 항목들.
- `app_clients (1) ── (N) sheet_links` : MVP는 테넌트당 1개로 제한(`UNIQUE(client_id)`). 향후 게이트별 다중 시트로 확장 시 제약 완화.
- `access_events (1) ── (0..N) notifications` : 한 출입 이벤트가 0~여러 알림을 유발(원인 추적용 `event_id` 참조).

### 3.3 결정적 제약 (이게 정합성을 만든다)

| 제약 | 목적 | 블라스트 레이디어스 |
|------|------|---------------------|
| `access_events UNIQUE(client_id, event_id)` | 멱등성 DB 방어선 | 없으면 음영 복구 재전송 시 중복 출입 기록 → 명부·인원집계 오염 |
| `notifications UNIQUE(client_id, event_id, type)` | 알림 1회 발송 보장 | 없으면 같은 이벤트로 푸시 폭주 |
| `device_registrations UNIQUE(client_id, fcm_token)` | 토큰 중복 방지 | 없으면 동일 기기에 N중 푸시 |

> TypeORM은 부분 인덱스/복합 UNIQUE를 `@Index(..., { unique: true })` 또는 `@Unique()`로 선언한다. 마이그레이션으로 명시 생성하고, 애플리케이션 레벨 멱등성(§4)과 **이중으로** 건다.

---

## 4. Redis 멱등성 인터셉터 (핵심)

### 4.1 왜 인터셉터인가 (NestJS 프리미티브 선택)

| 후보 | 단점 | 결론 |
|------|------|------|
| Middleware | 라우트/핸들러 메타데이터 접근 제한, 응답 본문 replay 어려움 | 부적합 |
| Guard | `boolean`만 반환. **캐시된 응답 본문을 돌려줄 수 없음** | 부적합 |
| **Interceptor** | 핸들러를 감싸고, `next.handle()`을 호출하지 않으면 **단축(short-circuit)**해서 캐시 결과를 그대로 반환 가능 | **채택** |

`Interceptor`는 가드(인증) 이후, 핸들러 이전/이후를 감싼다. 중복 요청이면 `next.handle()`을 건너뛰고 저장된 결과를 `of(cachedResult)`로 즉시 반환한다. 정확히 멱등성이 필요로 하는 동작이다.

### 4.2 두 계층의 멱등성 (중요)

단일 수집과 배치 수집은 멱등 처리 위치가 다르다. 이걸 한 군데서 처리하려 하면 배치의 부분 성공이 깨진다.

```
계층 A — 요청 단위 (IdempotencyInterceptor)
  대상: POST /v1/access-events (단일)  +  배치 전체 replay 방지
  키:   Idempotency-Key 헤더 (클라이언트 제공) 또는 단일 이벤트의 event_id
  효과: 같은 요청 통째로 재전송 → 저장된 HTTP 응답 그대로 반환

계층 B — 이벤트 단위 (AccessEventsService, 배치 내부)
  대상: POST /v1/access-events:batch 안의 각 이벤트
  키:   client_id:event_id (이벤트 자연 키)
  효과: 배치 200건 중 일부는 신규(accepted), 일부는 중복(duplicate)
        → 이벤트별 status 배열로 부분 성공 응답
```

> 인터셉터는 "요청을 통째로 한 번만"이고, 서비스 계층은 "이벤트를 정확히 한 번만"이다. 음영 복구 배치는 계층 B가 핵심이다.

### 4.3 단일 수집 시퀀스 (Interceptor 경로)

```
Client(SDK)        ApiKeyGuard      IdempotencyInterceptor      Handler/Service        Redis            PostgreSQL
   │                   │                     │                       │                  │                 │
   │ POST /v1/access-events                  │                       │                  │                 │
   │ Authorization: Bearer chk_...           │                       │                  │                 │
   │ Idempotency-Key: <eventId>              │                       │                  │                 │
   ├──────────────────►│                     │                       │                  │                 │
   │            verify api_key_hash (SHA-256), is_active             │                  │                 │
   │                   ├────────────────────►│                       │                  │                 │
   │                   │   key = idemp:{clientId}:{idemKey}          │                  │                 │
   │                   │                     │ SET key "PENDING" NX EX 35d            │                  │
   │                   │                     ├───────────────────────────────────────►│                 │
   │                   │                     │                       │   (a) 1 (선점성공=신규)             │
   │                   │                     │◄───────────────────────────────────────┤                 │
   │                   │                     │ next.handle() ───────►│                  │                 │
   │                   │                     │                       │ INSERT access_events             │
   │                   │                     │                       │ (UNIQUE client_id,event_id)      │
   │                   │                     │                       ├─────────────────────────────────►│
   │                   │                     │                       │  emit AccessEventCreated → BullMQ │
   │                   │                     │  result ◄─────────────┤                  │                 │
   │                   │                     │ SET key result(JSON) EX 35d  (PENDING→DONE)               │
   │                   │                     ├───────────────────────────────────────►│                 │
   │◄──────────────────────────────────────┤  201 {eventId, status:"accepted"}        │                 │
   │                   │                     │                       │                  │                 │
   │ ── 재전송 (같은 키) ──────────────────► │ SET ... NX → (b) nil (선점실패=중복)      │                 │
   │                   │                     ├───────────────────────────────────────►│                 │
   │                   │                     │ GET key → "DONE" + result                                 │
   │                   │                     │◄───────────────────────────────────────┤                 │
   │◄──────────────────────────────────────┤  200 {eventId, status:"duplicate"} (replay, 핸들러 미실행)  │
```

경합(동시 2요청, 같은 키):

```
   req1: SET NX → 1 (선점)            req2: SET NX → nil (패배)
        │                                  │ GET key → "PENDING"
        │ INSERT ... (처리 중)              │ 짧은 백오프 폴링 (예: 50ms*N, 상한 ~2s)
        │ SET key DONE+result              │ GET key → "DONE" + result
        ▼                                  ▼
   201 accepted                       200 duplicate (동일 result, 이중 INSERT 없음)
```

폴링이 상한 내 `DONE`을 못 보면(처리 지연/크래시): `409 Conflict` 또는 `425 Too Early` 대신 **DB 사실을 신뢰**한다. 서비스가 `INSERT ... ON CONFLICT DO NOTHING` 후 `RETURNING`으로 실제 행을 읽어 결과를 만든다. Redis 상태가 꼬여도 DB가 진실이다.

### 4.4 배치 수집 시퀀스 (Service 경로, 부분 성공)

```
AccessEventsController.ingestBatch(dto)
   │  dto: { events: IngestEventDto[] }   (class-validator로 형식 검증)
   ▼
AccessEventsService.ingestMany(clientId, events)
   │
   │  1) seq 오름차순 정렬 (단말 시간순 보장)
   │
   │  2) Redis 파이프라인으로 일괄 선점:
   │        MULTI
   │          SET idemp:{c}:{e1} PENDING NX EX 35d
   │          SET idemp:{c}:{e2} PENDING NX EX 35d
   │          ...
   │        EXEC  → [1, nil, 1, ...]  (nil = 이미 처리됨 후보)
   │
   │  3) 신규 후보만 단일 트랜잭션에서:
   │        INSERT INTO access_events (...) VALUES ...
   │          ON CONFLICT (client_id, event_id) DO NOTHING
   │          RETURNING id, event_id            ◄── DB가 최종 중복 판정
   │
   │  4) 각 이벤트 status 매핑:
   │        RETURNING 에 있음            → accepted (+ 도메인 이벤트 발행)
   │        Redis nil 또는 ON CONFLICT  → duplicate
   │        검증 실패(형식)              → rejected + reason
   │        occurred_at 7일 초과 지연    → accepted + late_arrival=true
   │
   │  5) accepted 건만 BullMQ 잡 발행 (sheet-mirror, notify)
   ▼
응답: { results: [{ eventId, status, reason? }, ...] }   ◄── 단말이 큐에서 무엇을 지울지 정확히 판단
```

핵심 설계 포인트:
- **`ON CONFLICT DO NOTHING ... RETURNING`** 이 멱등성의 진짜 심장이다. Redis 파이프라인은 "빠른 1차 필터"일 뿐, TTL 만료/Redis 유실/경합을 DB UNIQUE가 받아낸다. Redis와 DB 어느 쪽이 죽어도 중복은 안 생긴다.
- 신규만 `INSERT`하므로 한 배치 = 한 트랜잭션 = 한 번의 왕복. 200건이 효율적으로 처리된다.
- BullMQ 잡 발행은 **트랜잭션 커밋 이후**에 한다(커밋 안 된 이벤트로 알림이 나가면 안 됨). 트랜잭션 안에서 발행하면 롤백 시 유령 잡이 생긴다.

### 4.5 멱등성 키 / TTL 정책

```
키 형식 : idemp:{clientId}:{eventId}
값      : "PENDING" → 처리 중,  {"id":"...","status":"accepted"} → 완료
TTL     : 35일  (단말 큐 최대 보존 30일 + 여유 5일)
방어선  : 1) Redis SET NX (빠른 필터)
          2) PostgreSQL UNIQUE(client_id, event_id) (최종 진실)
```

TTL이 만료된 뒤 지연 재전송이 와도 DB UNIQUE가 막는다. TTL은 비용(메모리) vs 안전의 균형이고, DB 방어선이 있으므로 무한히 길 필요는 없다.

---

## 5. 수집 후 비동기 파이프라인

```
AccessEventCreated (도메인 이벤트, 커밋 후 발행)
        │
        ├──► BullMQ queue "sheet-mirror"  ──► SheetSyncProcessor
        │         job: { clientId, accessEventId }      │
        │                                               ├─ 1~2s 윈도우로 행 배칭
        │                                               ├─ spreadsheets.values.append
        │                                               │   (행 키에 event_id 포함 → 중복 append 차단)
        │                                               └─ 실패 시 BullMQ 지수 백오프 재시도
        │                                                   장기 실패 → DLQ + 운영 알림
        │
        └──► BullMQ queue "notify"  ──────► NotificationsProcessor
                  job: { clientId, accessEventId }       │
                                                         ├─ 테넌트 알림 룰 평가 (decision/direction/gate)
                                                         ├─ late_arrival 이면 푸시 skip (inbox만)
                                                         ├─ notifications INSERT
                                                         │   ON CONFLICT(client_id,event_id,type) DO NOTHING
                                                         │   → 알림도 멱등
                                                         ├─ FCM 발송 (Firebase Admin)
                                                         │   UNREGISTERED/INVALID → 토큰 is_valid=false
                                                         └─ 우선순위 높고 미확인 → 폴백 에스컬레이션
```

설계 근거:
- 동기 응답 경로(수집)에서 구글/FCM을 절대 호출하지 않는다. 외부 API 지연/쿼터가 수집 p95를 망가뜨리면 안 된다(blast radius 격리).
- BullMQ가 재시도/백오프/DLQ를 내장하므로 직접 구현하지 않는다(boring by default).
- 워커는 멱등해야 한다. 잡 재시도로 같은 `accessEventId`가 두 번 처리돼도 시트 행 1개, 알림 1개.

---

## 6. 오프라인 큐 동기화 계약 (서버 측 책임)

단말 SDK가 음영 구간 버퍼를 갖는다는 전제(PRD §6.3) 위에서, 서버는 다음을 보장한다.

- **배치 엔드포인트**: `POST /v1/access-events:batch`, 최대 200건/요청. 초과 시 `413`.
- **부분 성공 응답**: 이벤트별 `accepted | duplicate | rejected(+reason)`. 단말은 `rejected`가 아닌 항목만 로컬 큐에서 제거한다.
- **지연 도착 수용**: 오래된 `occurred_at`도 거절하지 않고 `late_arrival=true`로 저장. 실시간 알림은 울리지 않는다.
- **순서**: 서버가 `client_event_seq` 오름차순으로 정렬 처리. `occurred_at`(단말 시각)과 `received_at`(서버 시각) 모두 저장해 시계 오차를 사후 보정 가능하게 한다.

---

## 7. 횡단 관심사

| 관심사 | 구현 | 위치 |
|--------|------|------|
| 인증 | `ApiKeyGuard` (전역). `chk_` 파싱 → SHA-256 → `api_key_hash` 대조 → `is_active` 확인 → `req.clientId` 주입 | `auth/guards` |
| 입력 검증 | 전역 `ValidationPipe` (`whitelist:true`, `transform:true`) + class-validator DTO | `main.ts`, `dto/` |
| 에러 처리 | 전역 `ExceptionFilter`. DB UNIQUE 위반 → `duplicate`로 변환(500 아님) | `core/filters` |
| 테넌트 격리 | 모든 쿼리에 `client_id` 필수 조건. 서비스 시그니처에 `clientId` 강제 | 서비스 계층 |
| 관측성 | 큐 적체 깊이, 멱등 충돌율, 시트 미러 지연, FCM 실패율 메트릭 | `core/observability` |
| 설정 | `@nestjs/config` (이미 의존성에 있음). Redis/Google/FCM 자격증명 | `core` |

---

## 8. 테스트 전략

테스트가 부족한 것보다 많은 게 낫다. 멱등성/동시성은 특히 촘촘히.

| 레이어 | 무엇을 | 도구 |
|--------|--------|------|
| 단위 | `IdempotencyService.SET NX` 분기(신규/중복/PENDING 폴링), 룰 평가, 토큰 무효화 | Jest, ioredis-mock |
| 통합 | 배치 부분 성공(accepted/duplicate/rejected 혼합), `ON CONFLICT` 동작 | Jest + Testcontainers(PG, Redis) |
| 동시성 | **같은 event_id 1000회 동시·연속 → DB 1행, 응답 동일** (PRD AC) | 병렬 supertest |
| 장애 주입 | Redis 플러시 후 재전송 → DB UNIQUE가 여전히 막는지 | 통합 |
| 워커 | 잡 재시도로 시트 행/알림 중복 안 생기는지 | BullMQ 테스트 모드 |
| 지연 도착 | `late_arrival` 이벤트는 inbox만, 푸시 skip | 통합 |
| e2e | 음영 5분 시나리오: 끊김 → 버퍼 → 복구 배치 → 무손실 | jest-e2e (기존 설정 활용) |

> 가장 중요한 테스트는 §4.3 경합 시퀀스와 §4.4 배치 부분 성공이다. 여기가 깨지면 출입 명부 정합성이 무너진다.

---

## 9. 배포 / 인프라

- **Redis**: 멱등성 키는 휘발되면 안 되는 준영속 데이터다. AOF(append-only file) 활성화 + HA(센티넬 또는 매니지드 Redis). 단, DB UNIQUE 방어선 덕분에 Redis 순단이 데이터 정합성을 깨지는 않는다(성능만 잠시 저하).
- **마이그레이션**: TypeORM 마이그레이션으로 신규 테이블/제약 생성. `synchronize:false` 유지(운영 안전).
- **워커 스케일링**: API 인스턴스와 BullMQ 워커를 분리 배포. 시트/알림 부하가 수집 API를 막지 않게 한다.
- **시크릿**: Google 서비스 계정 키, Firebase 자격증명은 시크릿 매니저. 코드/리포에 절대 미포함.

---

## 10. 블라스트 레이디어스 / 리스크

| 시나리오 | 영향 범위 | 완화 |
|----------|-----------|------|
| Redis 다운 | 멱등 1차 필터 무력화, 성능 저하 | DB UNIQUE가 정합성 유지. AOF+HA로 복구 |
| 트랜잭션 내 잡 발행 후 롤백 | 유령 알림/시트 행 | 잡은 **커밋 후** 발행 (§4.4) |
| 시계 오차 큰 단말 | 정렬·지연 판정 왜곡 | `client_event_seq` 우선 정렬, `received_at` 병기 |
| 구글 쿼터 초과 | 시트 미러 지연 | 1~2s 배칭, 백오프, DLQ |
| 배치 부분실패 오해 | 단말이 미전송분 삭제 → 유실 | 이벤트별 status 배열 (§6) |

---

## 11. 미해결 결정 (엔지니어링 판단 필요)

PRD §13의 오픈 퀘스천 중 아키텍처에 직접 영향을 주는 것들. 코딩 전에 정해야 한다.

1. **시트 인증 방식**: 서비스 계정(테넌트가 시트를 서비스 계정 이메일에 공유) vs 테넌트 OAuth. 전자는 운영 단순/온보딩 마찰, 후자는 권한 명확/구현 복잡. **추천: MVP는 서비스 계정.** `sheet_links.auth_mode`로 향후 확장 여지만 남긴다.
2. **`occupancy`(현재 내부 인원) 구현**: 조회 시 집계(`SUM(IN)-SUM(OUT)`) vs 머터리얼라이즈드 뷰/증분 카운터. **추천: 초기엔 조회 시 집계(boring), 부하 측정 후 증분 전환.** 조기 최적화 회피.
3. **단일 Redis로 멱등성 + BullMQ 공유 vs 분리**: **추천: MVP 공유, 처리량 한계 도달 시 분리.** 혁신 토큰 절약.
4. **DTO 검증 실패 배치 처리**: 배치 내 일부 이벤트만 형식 오류일 때 — 전체 400 vs 해당 건만 `rejected`. **추천: 해당 건만 rejected(부분 성공 일관성).**

---

## 부록 A. 핵심 엔티티 TypeORM 스케치 (계약 수준)

```ts
// access-events/entities/access-event.entity.ts
@Entity('access_events')
@Unique('uq_access_event_idem', ['clientId', 'eventId']) // ◄ 멱등성 최종 방어선
@Index('idx_access_event_occurred', ['clientId', 'occurredAt'])
export class AccessEventEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'client_id' }) clientId: string;     // FK → app_clients.id
  @Column('uuid', { name: 'event_id' }) eventId: string;       // 단말 생성, 멱등 키
  @Column({ name: 'device_id' }) deviceId: string;
  @Column({ name: 'gate_id' }) gateId: string;
  @Column({ name: 'subject_id' }) subjectId: string;
  @Column({ type: 'varchar' }) direction: 'IN' | 'OUT';
  @Column({ type: 'varchar' }) decision: 'GRANTED' | 'DENIED';
  @Column({ name: 'occurred_at', type: 'timestamptz' }) occurredAt: Date;
  @Column({ name: 'received_at', type: 'timestamptz' }) receivedAt: Date;
  @Column({ name: 'client_event_seq', type: 'bigint' }) clientEventSeq: string;
  @Column({ name: 'late_arrival', default: false }) lateArrival: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

> `ClientEntity`(기존)의 컬럼 네이밍 규약(snake_case `name:` 매핑, `timestamptz`)을 그대로 따랐다. 일관성이 곧 유지보수성이다.
