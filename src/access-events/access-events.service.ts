import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessEventEntity } from './entities/access-event.entity';

@Injectable()
export class AccessEventsService {
  constructor(
    @InjectRepository(AccessEventEntity) // access_events 테이블에 접근할 레포지토리 주입
    private readonly accessEventsRepository: Repository<AccessEventEntity>,
  ) {}
}
