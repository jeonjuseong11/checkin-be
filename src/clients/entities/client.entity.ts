// src/clients/entities/client.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('app_clients') // 데이터베이스 테이블 이름을 'app_clients'로 지정
export class ClientEntity {
  @PrimaryGeneratedColumn('uuid') // ID를 중복 확률이 없는 UUID 형식으로 자동 생성
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  @Column({ type: 'varchar', name: 'api_key_hash', unique: true })
  apiKeyHash: string; // 보안을 위해 SHA-256으로 암호화해서 저장할 필드

  @Column({ type: 'varchar', length: 50, name: 'api_key_preview' })
  apiKeyPreview: string; // 관리자 화면에서 "chk_abc123..." 처럼 식별하기 위한 용도

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean; // 서비스 이용 정지 등의 상태 관리를 위한 플래그

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
