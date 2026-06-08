// src/clients/clients.service.ts
import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientEntity } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import * as crypto from 'crypto'; // Node.js 내장 암호화 모듈

@Injectable() // 💡 NestJS가 이 클래스를 필요한 곳에 자동으로 주입(DI)해줄 수 있도록 설정
export class ClientsService {
  constructor(
    @InjectRepository(ClientEntity) // 데이터베이스 테이블에 접근할 수 있는 레포지토리 주입
    private readonly clientsRepository: Repository<ClientEntity>,
  ) {}

  async createClient(
    createClientDto: CreateClientDto,
  ): Promise<{ client: ClientEntity; plainApiKey: string }> {
    const { name, email } = createClientDto;

    // 1. 이미 가입된 이메일인지 확인
    const existingClient = await this.clientsRepository.findOne({
      where: { email },
    });
    if (existingClient) {
      // NestJS가 제공하는 예외 처리 내장 기능 (자동으로 409 Conflict 에러 반환)
      throw new ConflictException('이미 등록된 담당자 이메일입니다.');
    }

    // 2. 외부 고객사용 고유 API Key 문자열 생성 (예: chk_a1b2c3...)
    const plainApiKey = `chk_${crypto.randomBytes(32).toString('hex')}`;

    // 3. API Key를 안전하게 SHA-256으로 해싱(단방향 암호화)
    const apiKeyHash = crypto
      .createHash('sha256')
      .update(plainApiKey)
      .digest('hex');
    const apiKeyPreview = `${plainApiKey.substring(0, 10)}...`;

    // 4. 데이터베이스에 저장할 엔티티 객체 생성 및 저장
    const client = this.clientsRepository.create({
      name,
      email,
      apiKeyHash,
      apiKeyPreview,
    });

    const savedClient = await this.clientsRepository.save(client);

    // 원본 키(plainApiKey)는 딱 지금 이 순간에만 화면에 보여주고 다시는 조회할 수 없게 설계합니다.
    return {
      client: savedClient,
      plainApiKey,
    };
  }
}
