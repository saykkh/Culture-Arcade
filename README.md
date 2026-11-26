# LS전선 WAY ARCADE (신규입사자 상시 개인 플레이 파일럿 v0.4)

LS전선의 **미션 · 비전 · 핵심가치(C.O.R.E.) · 경영철학** 공식 표현과 뜻을 전자 오락기 조작감으로 익히는 PC 웹 온보딩 아케이드입니다.

## 1. 로컬 실행 및 검증 명령

```bash
npm install
npm run dev      # 로컬 개발 서버 + API 미들웨어 실행 (http://localhost:5173)
npm test         # Vitest 단위·경계·인수·부하(30명 동시) 테스트 실행
npm run lint     # Oxlint 정적 검사
npm run build    # TypeScript 검사(tsc -b) 및 프로덕션 번들 빌드
```

## 2. 샘플 참가 및 운영 테스트 방법 (개발 · Preview 환경)

- **테스트 빠른 입장 코드**: `111111111111` (`1111-1111-1111`)
- **추가 샘플 코드**:
  - `LSWY-2026-PLAY` (`DEV-001`, 시작일 경과 · 즉시 입장 가능)
  - `LSWY-2099-WAIT` (`DEV-002`, `2099-01-01` 시작 · 시작일 전 잠금 화면 확인용)
- **운영 콘솔 (`/admin`)**:
  - `ARCADE_ADMIN_PASSWORD` 미설정 개발 환경 기본 비밀번호: `lsway-admin-dev`
  - 참가자 등록·코드 1회 원문 발급/재발급·일정 변경·UTF-8 BOM CSV 다운로드·문항 오답 경향(`n < 5` 표본 부족 보호) 확인 가능

## 3. 구현된 게임 6종

1. **산성비 타자 (`typing`)**: 60초(여유 75초·낙하 80%), 16슬롯, 10개 입력 클리어, 한글 IME 보호, 3연속 전류 연출
2. **단어 먹는 뱀 (`snake`)**: 90초(여유 120초·속도 80%), BFS 도달 보장, 경영철학→미션/비전→핵심가치 순서, 3문장 클리어
3. **가치 표적 슈팅 (`shooter`)**: 12문항(C·O·R·E 각 3문항, 세 위치 정답 4회 균등), 읽기 후 6초(여유 9초) 조준, 8정답 클리어
4. **3D 케이블 터널 레이싱 (`racing`)**: 75초(여유 105초·속도 80%), 공용 시뮬레이션 엔진 기반 Three.js 3D / 간소화 2D 전환 및 WebGL 손실 복구, 미션·비전 게이트, 순점수 1,000점 클리어
5. **C.O.R.E. 핀볼 (`pinball`)**: 100초(여유 125초·플리퍼 길이 115%), 120Hz 고정 시간 물리, 마지막 1글자 추천 경로 점등, 1세트 완성 클리어
6. **3D C.O.R.E. 관제실 탈출 (`control-room`, 보너스)**: 저폴리곤 3D 탐색 + 동기화된 ‘패널 목록’ 대체 조작, 4단계 복구 후 출구 작동 시 별도 관제등 점등

## 4. 환경변수 이름 (값은 커밋하지 않음)

| 변수명 | 용도 | 필수 여부 |
| --- | --- | --- |
| `ARCADE_ENV` | `production` 설정 시 미승인 샘플 콘텐츠 배정 차단 및 가상 샘플 비활성화 | 운영 필수 |
| `ARCADE_CODE_PEPPER` | 개인 코드 HMAC-SHA256 조회값 생성용 서버 비밀키 | 운영 필수 |
| `ARCADE_ADMIN_PASSWORD` | `/admin` 운영자 콘솔 인증 비밀번호 | 운영 필수 |
| `ARCADE_ADMIN_SECRET` | 운영자 세션 서명용 비밀키 | 운영 권장 |
| `SUPABASE_URL` | 운영 Supabase 프로젝트 URL (`supabase/migrations/` 스키마 적용 대상) | 운영 DB 연동 시 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 Supabase Service Role 키 | 운영 DB 연동 시 |
| `VITE_FIREBASE_*` | 기존 저장소 Firebase 웹 SDK 연동용 공개 설정값 6종 | 선택 유지 |
| `OPENAI_API_KEY` | 기존 로컬 `.env.local` 서버 측 보관용 키 (클라이언트 번들 비노출) | 선택 유지 |
