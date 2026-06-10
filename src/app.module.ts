// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from './clients/clients.module';
import { AccessEventsModule } from './access-events/access-events.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    // 1) .env 로딩. isGlobal=true 라서 모든 모듈에서 ConfigService 주입 가능
    ConfigModule.forRoot({ isGlobal: true }),

    // 2) DB 연결을 앱 전체에 1회 설정(forRoot).
    //    설정값이 .env(ConfigService)에서 와야 하므로 Async + inject 사용.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        // forFeature로 등록된 엔티티들을 자동으로 모아준다(엔티티 목록 수동 관리 불필요)
        autoLoadEntities: true,
        // 학습용: 엔티티 정의에 맞춰 테이블을 자동 생성/변경. 운영에서는 false + 마이그레이션.
        synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
      }),
    }),

    // 3) Redis 클라이언트를 전역 등록(@Global). 멱등 인터셉터가 주입받는다.
    RedisModule,

    ClientsModule,

    AccessEventsModule,
  ],
})
export class AppModule {}
