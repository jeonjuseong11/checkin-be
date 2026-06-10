// src/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// DI 주입 토큰. 클래스가 아닌 외부 라이브러리 인스턴스를 주입할 땐 문자열/심볼 토큰을 쓴다.
export const REDIS_CLIENT = 'REDIS_CLIENT';

// @Global: 한 번 등록하면 어느 모듈에서든 import 없이 REDIS_CLIENT를 주입받을 수 있다.
//          (TypeOrmModule.forRoot가 전역 커넥션을 까는 것과 같은 결)
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService], // 팩토리에 ConfigService를 주입(.env 값 읽기)
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          // 멱등 인터셉터는 Redis 장애 시 DB(계층 B)로 폴백하므로,
          // 요청이 Redis 응답을 무한정 기다리지 않게 재시도/타임아웃을 짧게 둔다.
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
