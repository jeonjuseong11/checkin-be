// src/auth/current-client.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ClientEntity } from '../clients/entities/client.entity';
import { AuthenticatedRequest } from './api-key.guard';

// 커스텀 파라미터 데코레이터. ApiKeyGuard가 request.client에 실어둔 고객사를 꺼낸다.
//   @CurrentClient()        → ClientEntity 전체
//   @CurrentClient('id')    → client.id 만
// @Req()로 날것의 request를 다루는 대신, 필요한 값만 깔끔히 주입받는 DI 스타일.
export const CurrentClient = createParamDecorator(
  (data: keyof ClientEntity | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const client = request.client;
    return data ? client?.[data] : client;
  },
);
