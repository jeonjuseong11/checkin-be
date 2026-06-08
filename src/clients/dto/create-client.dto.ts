// src/clients/dto/create-client.dto.ts
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty({ message: '고객사 이름은 필수 항목입니다.' })
  @Length(2, 50, {
    message: '고객사 이름은 2자 이상 50자 이하로 입력해주세요.',
  })
  name: string; // 예: "강남 대형학원", "제1연구소"

  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  @IsNotEmpty({ message: '담당자 이메일은 필수 항목입니다.' })
  email: string;
}
