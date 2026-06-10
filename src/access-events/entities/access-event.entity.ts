// src/access-events/entities/access-event.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';

// @Unique: 한 테넌트(client_id) 안에서 단말이 생성한 event_id는 단 하나만 존재.
//          ◄ 멱등성 최종 방어선. Redis가 죽어도 DB가 중복 출입 기록을 차단한다.
// @Index : 명부/인원집계 조회는 항상 "특정 테넌트의 시간순" 이므로 (client_id, occurred_at) 복합 인덱스.
@Entity('access_events') // 데이터베이스 테이블 이름
@Unique('uq_access_event_idem', ['clientId', 'eventId'])
@Index('idx_access_event_occurred', ['clientId', 'occurredAt'])
@Index('idx_access_event_gate', ['clientId', 'gateId', 'occurredAt'])
export class AccessEventEntity {
  @PrimaryGeneratedColumn('uuid') // 서버 내부 식별자(중복 없는 UUID)
  id: string;

  @Column('uuid', { name: 'client_id' })
  clientId: string; // FK → app_clients.id (테넌트 격리: 모든 쿼리에 필수)

  @Column('uuid', { name: 'event_id' })
  eventId: string; // 단말(기기)이 생성한 멱등 키. (client_id, event_id)로 유일.

  @Column({ name: 'device_id' })
  deviceId: string; // 이벤트를 올린 단말 식별자

  @Column({ name: 'gate_id' })
  gateId: string; // 출입문/게이트 식별자

  @Column({ name: 'subject_id' })
  subjectId: string; // 출입 주체(직원/방문자 등) 식별자

  @Column({ type: 'varchar' })
  direction: 'IN' | 'OUT'; // 입실/퇴실 방향

  @Column({ type: 'varchar' })
  decision: 'GRANTED' | 'DENIED'; // 출입 허용/거부 판정

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date; // 단말에서 "실제로 발생한" 시각(오프라인 큐 대비, 시간대 포함 저장)

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date; // 서버가 "수신한" 시각

  @Column({ name: 'client_event_seq', type: 'bigint' })
  clientEventSeq: string; // 단말이 매기는 단조 증가 시퀀스. bigint는 JS number 범위를 넘으므로 string 매핑.

  @Column({ name: 'late_arrival', default: false })
  lateArrival: boolean; // 뒤늦게(음영 복구 등) 도착한 이벤트인지 표시

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date; // 행 생성 시각(TypeORM 자동 관리)
}
