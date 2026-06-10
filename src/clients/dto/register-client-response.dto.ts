// src/clients/dto/register-client-response.dto.ts
import { ClientEntity } from '../entities/client.entity';

// 고객사 등록 성공 시 "밖으로 내보내도 되는 것만" 담는 응답 그릇.
// ❗ apiKeyHash(해시된 비밀키)는 절대 담지 않는다 — 엔티티엔 있지만 여기서 의도적으로 뺀다.
export class RegisterClientResponseDto {
  id: string;
  name: string;
  email: string;
  apiKeyPreview: string; // "chk_abc123..." 식별용 (해시 아님, 노출 OK)
  isActive: boolean;
  createdAt: Date;

  // 원본 API Key — 등록 직후 딱 한 번만 응답에 실어 보낸다. 이후 다시는 조회 불가.
  apiKey: string;

  constructor(client: ClientEntity, plainApiKey: string) {
    this.id = client.id;
    this.name = client.name;
    this.email = client.email;
    this.apiKeyPreview = client.apiKeyPreview;
    this.isActive = client.isActive;
    this.createdAt = client.createdAt;
    this.apiKey = plainApiKey;
  }
}
