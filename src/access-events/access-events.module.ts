import { Module } from '@nestjs/common';
import { AccessEventsController } from './access-events.controller';
import { AccessEventsService } from './access-events.service';

@Module({
  controllers: [AccessEventsController],
  providers: [AccessEventsService]
})
export class AccessEventsModule {}
