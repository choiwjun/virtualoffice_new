# 플랫폼 오픈 전 강력 QA — 종합 리포트 (2026-07-17)

3개 병렬 에이전트 레인 + 오케스트레이터 직접 실구동 QA. 라이브 dev 스택(backend :8000 / frontend :3000 / realtime :2567 / LiveKit 컨테이너) 대상.

## 종합 판정: **WATCH** — 코드·기능은 오픈 수준, 배포 계층/운영 보안이 오픈 게이트

비즈니스 로직·기능 구현은 정본과 높은 정합(라인 증거로 오탐 0건 확인). 오픈을 막는 것은 **배포 계층(docker-compose.yml이 폐기된 D26 스택)과 인터넷 공개 전제의 운영 보안 3종**이며, 이는 코드 결함이 아니라 배포·운영 준비 항목이다.

---

## 레인별 결과

### ① 기획↔구현 갭 감사 (architect) — 완료
`spec-gap-audit.md`. 판정 WATCH. P0 1건(docker-compose D26 잔존), P1 4건, P2 문서스테일 3건, 정합 확인 8영역(KPI 산식/워크플로우/팀벤치마크·근접검증·D31·D12·D17배치·보안로깅) 라인 증거로 결함 0.

### ② RBAC·경계 negative QA (executor) — 완료 **25 PASS / 0 FAIL**
`rbac-report.md`. 라이브 백엔드 대상 3계정 25건:
- compute admin전용(leader/employee 403), adjust ±10%·사유30자·leader 팀스코프(403), 이의신청 타인접수 403·category 422, 이의검토 admin전용 403
- notices 작성 employee/leader 403·admin 201, audit-logs employee 403
- integrations 계정격리·무인증 401·미지원 provider 404, trips 본인승인 403, reports 타인조회 403
- presence/batch 무인증·일반토큰 거부, floor-layout 내부토큰 거부
- 입력경계: work-log 비정상 enum 422, notices 256자 422, compute weekly 422, 위조 토큰 401
- 생성 데이터 정리(공지 삭제·출장 취소) 완료

### ③ redteam + 전체 회귀 (executor) — 완료(회귀 그린) + redteam 소실 조사·해소
`regression-report.md`.
- **backend 전체: 355 passed / 0 failed / 85 skipped** (skip=contract 스텁, conftest 강제)
- realtime: `npm test` 43/43(room 30+scene-floor 13), client-smoke 8/8, presence-smoke 6/6, layout-smoke 5/5(어써션)
- frontend: tsc 0 오류, vitest 11/11
- **redteam 소스 소실 조사**: `tests/redteam/*.py` 부재를 회귀 에이전트가 FAIL 보고 → 오케스트레이터가 git 이력 추적 → **1504d94(관리 API 라운드)에 존재했으나 D30 아키텍처 피벗 때 제거된 pre-D30 유물**로 확인. 복원 시도 결과 `/api` 프리픽스 없는 라우트(`/auth/login`→404)·삭제된 `test_user` 픽스처·UUID→sqlite 스키마 드리프트로 **107 failed/29 error** — 현행 아키텍처와 비호환. 되살리면 깨진 테스트만 증가하므로 복원분 제거. **보안 경계 커버리지는 레인②의 라이브 RBAC 25 PASS(현행 아키텍처 기준)가 대체**. redteam 스위트 현대화는 별도 백로그.

### ④ 사무실 구조 변경 실구동 QA (오케스트레이터) — 완료
D12 레이아웃 수명주기를 편집기 UI + 직접 API로 실증:
- **편집기(브라우저)**: 편집기 로드(Konva 캔버스+버전패널) → 구조 변경(좌석+방+구역+벽 추가·드래그, 저장대기 배지) → 모두 저장(좌석 CRUD) → 미검증 draft 배포 버튼 비활성(D12 게이트). 스크린샷 `shots-roles/L2-editor-modified.png`, `L4-deployed.png`.
- **배포 반영·롤백(직접 API, 실 UUID 결정적)**: draft→validate→deploy 후 `GET /api/realtime/floor-layout`(내부토큰) **200**(이동서버 소비 가능), 미검증 draft 직접 배포 → **409**(D12 차단 게이트), rollback → **200** 직전 버전 재배포, cleanup 후 **404**(미배포 폴백 baseline 복귀). 정리 후 dev_qa.db는 WS 8석 + 레이아웃 0버전 baseline으로 복원.

---

## 수리 완료

- **[P1-3] 운영 기본 시크릿 기동 가드** — `Settings.assert_production_safe()` 신설: production 환경에서 dev 기본 JWT/내부토큰/LiveKit 시크릿으로 기동 시 `RuntimeError` fail-fast. `main.py` lifespan 최초 호출. 계약 테스트 추가(test_foundation, dev 통과·production 거부·강한시크릿 통과). backend 전체 356 passed 회귀 0.
- **[QA 인프라] 회의실 시드** — 직전 세션 seed_seats.py에 HORIZON 회의존 2실 추가(회의실예약 dev 실구동 가능).
- **DB 위생** — QA 생성 레이아웃 5버전·오염 좌석 정리, floor-layout 404 baseline 복귀.

## 미수리 — 오픈 전 조치 항목 (리포트 위임, 코드 결함 아님/대형)

| # | 항목 | 사유 |
|---|---|---|
| P0-1 | docker-compose.yml D29/D30 재작성(wa-* 제거, realtime/frontend 서비스, Caddyfile) | 대형·스테이징 완주 검증 필요 — blind 재작성 위험. 오픈 전 최우선. |
| P1-2 | 로그인 IP rate-limit(Caddy/미들웨어) | 배포 계층 결정 동반(P0-1과 함께) |
| P1-4 | realtime JWT_REQUIRED 운영 강제 | P0-1 compose에 realtime 서비스 추가 시 env로 강제 |
| P1-5 | D31 access_token 암호화 저장 | 결정문 '운영 전' 게이트 — env 키 대칭암호화 |
| P2-6~8 | 14-spec §2 상태표·WASD·8항목 문서 갱신, chat 스코프 결정 | 문서/제품결정 |

## 알려진 WARN (비차단)
- realtime layout-smoke: 어써션 5/5 PASS이나 Windows tsx/libuv 클린업으로 exit 9 크래시(CI 오탐 위험).
- load-sim: 하드코딩 :2599 자체 서버 대상(라이브 :2567 미대상) — p95=135ms 참고치.
- pytest deprecation 3종(Pydantic V1 Config, json 필드 shadow, HTTP_422 상수) — 버전 업그레이드 시 정리.
