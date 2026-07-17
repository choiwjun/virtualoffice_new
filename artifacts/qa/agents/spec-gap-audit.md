# 기획↔구현 정합 감사 — spec-gap-audit (2026-07-17)

> 범위: 01-prd §7 / 06-screens / 08-kpi-logic §2·§3·§5.4 / 09-realtime §1.2·§3.3·§5 / 14-spec §2 / 05-schema D12 / 00-decisions D14~D31 ↔ backend/app · frontend · realtime/src. 읽기 전용 실측(파일:라인 근거 필수 규칙 준수). 선행: qa-audit-2026-07-13.md, spec-impl-gap-audit-2026-07-13.md.
> 산출 주체: architect 서브에이전트(2-SpecGapAudit). 종합 판정 **WATCH**.

## (a) 발견 목록 (심각도별)

### P0 결함 (오픈 차단)
1. **프로덕션 docker-compose.yml = 폐기된 D26 WorkAdventure 스택** — wa-* 6서비스+WA_OIDC env 구성(docker-compose.yml:1-20 헤더 'D26' 명시, :60-66 WA_OIDC, :77-210 wa-*), 현 아키텍처 필수인 Colyseus realtime·Next.js frontend 서비스 부재. realtime Dockerfile 미작성(docker-compose.local.yml:7 주석). PRD §7 기술 수용기준 1번(01-prd.md:206 '단일 통합 스택 Docker Compose 배포 완료 D27/D29') 미충족 — 이 파일로는 제품을 오픈 배포할 수 없음. 14-spec §0 '정리 대상: docker WorkAdventure 스택(wa-*)' 미이행분.

### P1 불일치 (오픈 전 조치)
2. **로그인 IP rate-limit 미구현** — PRD §7 보안 수용기준(01-prd.md:234 'IP당 10 req/min')에 대해 구현은 email 키 5회/5분 잠금만(auth.py:31-66). email 키 잠금은 타인 계정 잠금 DoS 벡터 + 분산 브루트포스 미차단 + 인메모리(재시작 리셋). 인터넷 공개(D21-r) 전제라 오픈 전 필수.
3. **운영 기본 시크릿 가드 부재** — settings.is_production 정의만 있고 사용처 0곳(config.py:75). jwt_secret_key/internal_api_token dev 기본값(config.py:54,60)으로 production 기동해도 fail-fast 없음. → **[수리됨 2026-07-17] `Settings.assert_production_safe()` + main.py lifespan 호출 + 계약 테스트(test_foundation).**
4. **realtime 무인증 join 기본 허용** — JWT_REQUIRED 기본 false(realtime/src/config.ts:87), 미설정 배포 시 토큰 없는 join 통과(OfficeRoom.ts:119-121). JWT_SECRET도 dev 기본값 폴백(config.ts:84). #1의 compose에 realtime 서비스가 없어 운영 강제 지점 자체가 부재.
5. **D31 토큰 평문 DB 저장** — UserIntegration.access_token String(512) 평문(tables.py:1629-1630 자체 주석 '운영 전 암호화 저장 전환 필요'). D31 결정문 ③(00-decisions.md:220)이 '운영 전'을 게이트로 명시 — 이행 대기. (API 미노출 has_token·해제 즉시 삭제·본인 전용은 정합)

### P2 문서 스테일 (코드가 문서보다 앞섬 — 표기 갱신 대상)
6. **14-spec §2 상태표 최소 11항목 불일치**: ①아바타 커스터마이징 🟡→✅ ②이동서버 🆕→✅ ③HUD/미니맵 🟡→✅ ④좌석 클릭 UX 🟡→✅ ⑤근접 트리거 UX 🟡→✅ ⑥동의 배너 🟡→✅ ⑦A* 도달성 🟡→✅ ⑧JWT 핸드셰이크 🟡→✅ ⑨공지 🔴→✅ ⑩'레이아웃→Blender 렌더 파이프라인 🔴' = D29/D30 폐기·대체(tools/asset-gen, 18-문서 M0 완료 c964bc2) ⑪부하 🔴→인프로세스 20인 p95=131ms PASS.
7. **WASD 이동 문서 불일치** — 09 §1·14-spec §2.1 'WASD/마우스' vs 구현 클릭 이동 전용(keydown/WASD 핸들러 grep 0건). 서버는 목적지 무관 검증이라 보안 영향 없음. 문서 정정 또는 후속 UX 결정 필요.
8. **09 §1.2 '8항목' 표기** — 실구현 9체크(movement.ts MOVEMENT_CHECKS). 15-spec은 기정정, 09만 잔존.

### 기지 백로그 (qa-audit-2026-07-13 문서화 잔여 — 분류만)
좌석 편집 draft 완전 격리 재설계(P7), 폼 임시저장 페이지별, 아바타 색상 외형(스프라이트 한계), 층 선택 무기능(P7-T2), 12-tasks 표기 드리프트, **chat 스코프 결정 미결(06 §3.17:1375-1377 — 오픈=사용자 노출이므로 결정 기록 권장)**.

### 외부 게이트 (결함 아님 — 제약 준수 확인)
STT 501 스텁, LiveKit 실미디어 릴레이/Egress(토큰·2단계 입장까지 완료), ERP kpi_results 실전송(erp_push_endpoint mock), 100인 부하 실측(인프로세스 20인 PASS), 다층 렌더(P7-T2), 편집기→뷰포트 실시간 반영(18-문서 M1~M3 진행, M0 ✅).

## 정합 확인 (결함 0 — 라인 증거)
- **08 §2 산식 ↔ kpi_engine.py**: 가중치 30/25/20/15/10, 충실도 4요소(goal30/category20/result_url30/next_action20), decisions 2점/건·상한20, action 일일 상한 10, 결정론.
- **08 §5.4 ↔ compute_team_percentile**: user_team_history 겹침 판정, 모수<5 부서 폴백→None, (below+0.5×equal)/n.
- **08 §3 ↔ kpi.py**: ±10% 강제, 사유 ≥30자, finalize/이의검토 admin 전용, leader 팀스코프, 7일 자동확정, resolve→finalized→ERP push.
- **09 §3.3 근접 8항목 ↔ proximity.ts**: company/office/floor/distance(5m)/LOS/target_offline/cooldown/DND 전항목.
- **D31 ↔ integrations**: 본인 전용 CRUD·sync, GitHub 실존 검증+공개 이벤트, Figma /v1/me, 토큰 미노출, 해제 즉시 삭제, KPI 미반영 — 암호화만 잔여(P1-5).
- **D12 ↔ office_layout_validator.py**: 서버 단일 정밀검증, ERROR 배포 차단, 도달성 A* BFS.
- **D17 배치 ↔ scheduler.py**: 18:00 EOD·21:00 KPI·매시간 ERP·03:00/03:30 파기·09:00 자동확정·:30 자율석 반납.
- **보안 로깅**: 토큰/비밀 평문 로깅 grep 0건. CORS 명시 화이트리스트.

## (b) 종합 판정: **WATCH**
코드 골격·비즈니스 로직은 정본과 높은 정합(오탐 0건 기조 유지). 그러나 배포 계층(docker-compose.yml)이 2세대 전 아키텍처(D26)에 머물러 '오픈' 자체가 현재 불가능하고, 인터넷 공개 전제 보안 수용기준 3종(IP rate-limit·운영 시크릿 가드·realtime 인증 강제) 미충족. 문서(14-spec §2)는 대량 스테일.

## (c) 오픈 전 권장 조치 Top 5
1. **docker-compose.yml D29/D30 재작성** (P0-1): wa-* 제거, realtime Dockerfile+서비스(JWT_REQUIRED=true), frontend 서비스, Caddyfile 갱신 → 스테이징 1회 완주.
2. **운영 보안 가드 일괄** (P1-2/3/4): production 기본 시크릿 기동 거부[✅부분수리] + realtime JWT_REQUIRED 강제 + IP 로그인 rate-limit.
3. **D31 access_token 암호화 저장 전환** (P1-5).
4. **14-spec §2 상태표 실측 갱신** (P2-6).
5. **chat 스코프 제품 결정 기록** + WASD/8항목 문서 정정 (P2-7/8).
