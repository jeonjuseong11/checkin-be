# B2B SaaS 기반 하이브리드 출입 통제 및 실시간 감사 로그 시스템

> **checkin-be** / 네트워크 음영 지역 대응을 위한 Offline-First 기술 및 구글 시트 실시간 데이터 미러링 인프라

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)

---

## 1. 프로젝트 개요 (Executive Summary)

### 1.1 배경 및 필요성

- **인프라 종속성 제거:** 기존의 하드웨어 중심 출입 통제 시스템(전용 리더기, 폐쇄망 키오스크)은 고가의 설치 비용이 발생하여 중소형 학원, 대학 과실, 공유 오피스 등 소규모 인프라 도입에 한계가 있음.
- **하이브리드 환경의 동시성 이슈:** 모바일 기기(RN)를 활용한 현장 체크인 시, 지하이거나 벽이 두꺼운 **네트워크 음영 지역**에서 발생한 오프라인 대기열(Queue) 데이터가 네트워크 복구 시 서버로 일시에 몰릴 때 중복 처리 및 데이터 정합성 파괴 문제가 발생함.
- **행정 마감 자동화 요구:** 관리자가 출입 통계 뷰를 보기 위해 매번 별도의 백엔드 관리자 뷰에 접속해야 하는 번거로움을 해결하고, 기관에서 가장 친숙한 업무 도구인 **구글 시트(Google Sheets)로 데이터를 실시간 동기화**하여 행정 마감을 자동화하고자 함.

### 1.2 솔루션 제안

본 프로젝트는 외부 고객사(Client)가 자사 서비스에 출입 통제 기능을 플러그인 형태로 손쉽게 연동할 수 있도록 **고성능 오픈 API 인프라 및 SDK 백엔드 시스템**을 제공합니다. `Offline-First` 환경을 고려한 Redis 멱등성 검증 레이어, 하이브리드 알림 파이프라인을 내재화한 엔터프라이즈급 B2B SaaS 솔루션입니다.

---

## 2. 핵심 아키텍처 및 기술적 도전 과제

### 2.1 제어 제어 원칙 (Deterministic Architecture)

모든 비즈니스 판단, 권한 검증, 데이터 변형 및 멱등성 제어는 백엔드(NestJS)에서 100% 결정론적 코드로 직접 구현하여 제어권을 쥐며, 향후 확장될 LLM 기반 데이터 예측 엔진은 오직 통계 분석 보조 도구로만 제한하여 블랙박스가 없는 단단한 시스템을 지향합니다.

### 2.2 핵심 기능 명세

- **B2B API Key 발급 및 보안 체계:** 외부 서비스 등록 시 고유한 `X-API-KEY`를 발급하며, 데이터베이스 유출 대참사를 방지하기 위해 **SHA-256 단방향 암호화 해시값** 형태로 저장 및 검증합니다.
- **Redis 기반 멱등성 인터셉터:** 오프라인 상태의 클라이언트 앱이 누적된 출결 데이터를 일시에 벌크(Bulk) 전송할 때, 중복 요청 및 중복 입퇴실 처리를 원천 차단하는 분산 락/캐싱 레이어를 구축합니다.
- **구글 시트 실시간 데이터 미러링:** 행정 보고서 자동화를 위해 출입 이벤트 성공 즉시 Google Sheets API를 통해 데이터를 실시간으로 Append-Only 동기화합니다.
- **하이브리드 스마트 알림 라우터:** 출입 제한 구역 위반 또는 예외 상황 발생 시 비용이 없는 **Firebase 푸시 알림(FCM)**을 우선 발송하고, 수신 실패 시 카카오 알림톡/문자(SMS)로 자동 전환되는 이중 Fallback 레이어를 설계합니다.

---

## 3. 기술 스택 (Tech Stacks)

- **Framework:** NestJS (v10.x) - 모듈형 독립 구조 및 의존성 주입(DI) 아키텍처 채택
- **Language:** TypeScript - 엄격한 타입 시스템 활용 및 데이터 유효성 검사 자동화
- **Database:** PostgreSQL, TypeORM - 관계형 데이터의 안정적 영속성 관리
- **Caching & Concurrency:** Redis - 중복 요청 방지(멱등성) 및 세션 검증 최적화
- **Package Manager:** pnpm - 하드 링크 기반 디스크 용량 절감 및 호이스팅 없는 엄격한 의존성 격리
- **Error Tracking:** Sentry - 프로덕션 레벨 실시간 예외 모니터링

---

## 4. 디렉토리 아키텍처 규칙 (Directory Structure)

본 프로젝트는 단일 책임 원칙(SRP)에 따라 도메인 단위로 완벽하게 격리된 모듈 구조를 따릅니다.

```text
src/
├── app.module.ts            # 애플리케이션 최상위 루트 모듈 (전체 조립)
├── main.ts                  # 애플리케이션 진입점 및 글로벌 파이프라인 세팅
├── common/                  # 전역 공통 모듈 (Guards, Interceptors, Filters)
│   ├── guards/              # API Key 및 권한 검증 레이어
│   └── interceptors/        # Redis 멱등성 처리 레이어
└── clients/                 # [1단계] B2B 외부 고객사 관리 도메인
    ├── clients.module.ts    # 모듈 캡슐화 및 다른 도메인으로의 Export 정의
    ├── clients.controller.ts# HTTP 요청 수신 및 응답 반환 (문지기 레이어)
    ├── clients.service.ts   # API Key 발급, 암호화 등 핵심 비즈니스 로직 (셰프 레이어)
    ├── dto/                 # 데이터 전송 가방 및 class-validator 유효성 검사 규칙
    │   └── create-client.dto.ts
    └── entities/            # PostgreSQL 테이블 매핑을 위한 TypeORM 설계도
        └── client.entity.ts
```
