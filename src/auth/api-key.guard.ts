// src/auth/api-key.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ClientsService } from '../clients/clients.service';
import { ClientEntity } from '../clients/entities/client.entity';

// 가드가 인증에 성공하면 찾은 고객사를 요청 객체에 실어둔다.
// 컨트롤러는 @CurrentClient() 데코레이터로 이걸 꺼낸다.
export interface AuthenticatedRequest extends Request {
  client?: ClientEntity;
}

@Injectable() // 가드도 DI 대상 — ClientsService를 주입받는다.
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly clientsService: ClientsService) {}

  // true면 통과, 예외를 던지면 차단. Pipe/Handler보다 먼저 실행된다.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ExecutionContext = 요청 맥락 추상화. HTTP 요청 객체를 꺼낸다.
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Authorization: Bearer chk_xx... 헤더에서 키 추출
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('API 키가 필요합니다. (Authorization: Bearer)');
    }
    const plainApiKey = authHeader.slice('Bearer '.length).trim();

    // DB의 해시와 대조 + 활성 상태 확인
    const client = await this.clientsService.findActiveByApiKey(plainApiKey);
    if (!client) {
      throw new UnauthorizedException('유효하지 않거나 비활성화된 API 키입니다.');
    }

    // 통과: 인증된 고객사를 요청에 부착 → 핸들러에서 @CurrentClient로 사용
    request.client = client;
    return true;
  }
}
