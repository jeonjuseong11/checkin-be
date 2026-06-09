// src/clients/clients.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { ClientEntity } from './entities/client.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClientEntity]), // 이 모듈 안에서 ClientEntity 테이블을 쓰겠다고 선언
  ],
  controllers: [ClientsController], // 요청을 받을 라우터 등록
  providers: [ClientsService], // 비즈니스 로직을 실행할 핵심 공급자 등록
  exports: [ClientsService, TypeOrmModule], // 추후 다른 모듈(인증 가드 등)에서도 쓸 수 있게 공유
})
export class ClientsModule {}
