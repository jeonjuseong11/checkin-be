import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessEventsController } from './access-events.controller';
import { AccessEventsService } from './access-events.service';
import { AccessEventEntity } from './entities/access-event.entity';
import { ClientsModule } from '../clients/clients.module';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessEventEntity]), // 이 모듈 안에서 access_events 테이블을 쓰겠다고 선언
    ClientsModule, // ApiKeyGuard가 쓰는 ClientsService를 빌려온다(ClientsModule이 exports 중)
  ],
  controllers: [AccessEventsController],
  providers: [AccessEventsService, ApiKeyGuard], // 가드도 DI 대상이므로 provider로 등록
})
export class AccessEventsModule {}
