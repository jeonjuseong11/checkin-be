import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessEventsController } from './access-events.controller';
import { AccessEventsService } from './access-events.service';
import { AccessEventEntity } from './entities/access-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessEventEntity]), // 이 모듈 안에서 access_events 테이블을 쓰겠다고 선언
  ],
  controllers: [AccessEventsController],
  providers: [AccessEventsService],
})
export class AccessEventsModule {}
