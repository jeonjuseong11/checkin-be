// src/access-events/idempotency.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  Logger,
} from '@nestjs/common';
import { Observable, of, from, concatMap } from 'rxjs';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AuthenticatedRequest } from '../auth/api-key.guard';

const PENDING = 'PENDING';
const TTL_SECONDS = 35 * 24 * 60 * 60; // 35일 — 음영 복구 재전송 윈도우
const POLL_INTERVAL_MS = 50;
const POLL_MAX_ATTEMPTS = 40; // 50ms * 40 = ~2s 상한

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 계층 A 멱등성: "이 요청 통째로 전에 처리했나?"를 Redis로 판정.
// 신규면 핸들러 진행 후 결과를 캐시, 중복이면 핸들러를 건너뛰고(short-circuit) 캐시 응답을 돌려준다.
// Redis 장애 시엔 그냥 핸들러로 흘려보내 계층 B(DB ON CONFLICT)가 받치게 한다(graceful degradation).
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 멱등 키: 가드가 인증한 clientId + (Idempotency-Key 헤더 또는 바디의 eventId).
    // 인터셉터는 Pipe 이전이라 body는 아직 DTO로 변환 전이지만, express가 파싱한 raw JSON은 읽을 수 있다.
    const clientId = request.client?.id;
    const idemKey =
      (request.headers['idempotency-key'] as string | undefined) ||
      (request.body as { eventId?: string } | undefined)?.eventId;

    // 키를 못 만들면 멱등 처리 불가 → 그냥 통과(DB가 막는다).
    if (!clientId || !idemKey) {
      return next.handle();
    }
    const key = `idemp:${clientId}:${idemKey}`;

    try {
      // SET key PENDING NX EX 35d → 선점 시도. 'OK'면 내가 처음(신규), null이면 누가 이미 처리 중/완료.
      const won = await this.redis.set(key, PENDING, 'EX', TTL_SECONDS, 'NX');

      if (won) {
        // 신규: 핸들러를 실행하고, 결과가 나오면 PENDING → 실제 결과(JSON)로 덮어쓴다.
        return next.handle().pipe(
          concatMap((result) =>
            from(
              this.redis
                .set(key, JSON.stringify(result), 'EX', TTL_SECONDS)
                .then(() => result),
            ),
          ),
        );
      }

      // 중복 후보: 캐시가 DONE이 될 때까지 짧게 폴링(경합으로 PENDING일 수 있음).
      let cached = await this.redis.get(key);
      let attempts = 0;
      while (cached === PENDING && attempts < POLL_MAX_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS);
        cached = await this.redis.get(key);
        attempts++;
      }

      if (cached && cached !== PENDING) {
        // 캐시된 결과로 short-circuit — 핸들러를 실행하지 않는다(리플레이).
        return of(JSON.parse(cached));
      }

      // 폴링 상한 초과(처리 지연/크래시): Redis 상태를 믿지 말고 DB 사실로 — 그냥 핸들러 실행.
      // 핸들러의 ON CONFLICT DO NOTHING이 중복 INSERT를 막아준다.
      this.logger.warn(`Idempotency poll timeout for ${key} — DB로 폴백`);
      return next.handle();
    } catch (err) {
      // Redis 장애: 계층 B(DB)가 최종 방어선이므로 그대로 핸들러 진행.
      this.logger.warn(
        `Redis 멱등 처리 실패 — DB로 폴백: ${(err as Error).message}`,
      );
      return next.handle();
    }
  }
}
