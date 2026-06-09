// src/clients/clients.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';

@Controller('clients') // 💡 이 컨트롤러의 모든 API는 주소 앞에 `/clients`가 붙습니다.
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {} // 서비스 조립

  @Post('register') // 💡 POST /clients/register 요청을 처리함
  @HttpCode(HttpStatus.CREATED) // 성공 시 201 Created 응답 반환
  async registerClient(@Body() createClientDto: CreateClientDto) {
    // 요청 바디(@Body)로 들어온 데이터를 CreateClientDto 규격에 맞추어 서비스로 전달
    return await this.clientsService.createClient(createClientDto);
  }
}
