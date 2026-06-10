import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 전역 입력 검증 관문. 모든 라우트의 요청 바디/파라미터가 컨트롤러 도달 전에 여기를 통과한다.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 정의 안 된 필드는 제거(몰래 끼워넣기 차단)
      forbidNonWhitelisted: true, // 정의 안 된 필드가 오면 400으로 거부
      transform: true, // 평범한 객체를 DTO 클래스 인스턴스로 변환 + 타입 변환
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
