# 기획문서 ↔ 구현 소스 전수조사 (2026-07-13, HEAD=311968b)

> 6트랙 병렬 감사(①QA잔존 ②데이터모델·RBAC ③화면 ④KPI·ERP ⑤실시간·2.5D ⑥PRD·로드맵) + 메인 세션 직접 교차검증.
> 에이전트 오탐 4건(Colyseus 미구현설·D24 미구현설·presence TTL 미구현설·조직도 API 부재설)은 라인 증거로 **기각** 후 반영.
> 실측 규모: 백엔드 라우트 99개(19파일) · DB 테이블 27개 · 프론트 페이지 20개 · 백엔드 테스트 37파일 · realtime 검증 이동9/근접8.

---

## 0. 총평

| 영역 | 동기화율 | 비고 |
|---|---|---|
| 데이터모델 (04 vs tables.py) | **~99%** | 실결함 0. 과거 QA §4 미등재 6테이블은 04 v1.4 개정으로 전부 등재 완료 |
| KPI·ERP 로직 (08/03) | **~90%** | 산식·이의 상태머신·±10%·감사로그 정합. 잔여=외부 ERP 의존 + 배치 분리 |
| RBAC (rbac.yaml vs API) | **~73% 정합** | 게이트 존재율 100%, 정본 일치 11/15. **실결함 2건(P0)** |
| 실시간 서버 (15/09 vs realtime/) | **~95%** | 프로토콜 5종·검증 8+8·단일세션·재접속 전부 정합 |
| 화면 (06 vs frontend) | 라우트 100% / 상세 ~85% | 유령 화면 0. 신설 4종 문서화 후행 완료(§3.15~3.17) |
| PRD MUST 커버리지 | **~85%** (외부의존 제외 ~94%) | 치명적 코드 모순 0건. 잔여 갭 = 외부 연동·실측 게이트 |
| QA감사(2026-07-13) 27결함 | **수리 23 / 부분수리 4 / 잔존 0** | 커밋 6ac65fc·311968b 수리 주장 사실로 확인. 부분수리 4건(#14 완전격리=P7 유보·#17 단일상수·#21 스키마 유보·#27 ai_draft 구조)은 전부 의도적 유보 기록 존재. 잔여 확인 1건: D17 '18:00 이후 익일 귀속' 명시 구현 미확인 |

**한 줄 결론**: 코드 골격(D29 2.5D 렌더·Colyseus 20Hz·JWT 단일세션·KPI D14/D15/D16·WA 제거·좌표계 D25)은 전부 스펙 정합. 남은 것은 ①RBAC 실결함 2건, ②부분수리 9건 마감, ③외부 인프라 게이트 3종, ④문서 스테일(특히 01-prd).

---

## 1. 확정 결함 — 즉시 조치 (코드가 정본 위반)

> **조치 현황 (2026-07-13)**: #1·#2는 `fix/p0-rbac-objection-teamscope` 브랜치에서 수리 완료 — review_objection admin 전용화(`_check_admin_only`) + `_check_team_scope`에 평가기간 user_team_history 검사 추가(이력 0행 폴백=현재 소속, leader 팀은 DB 우선 조회로 JWT 스테일 해소). 회귀 테스트 3종 추가, 전체 스위트 333 passed.

| # | 심각도 | 결함 | 정본 근거 | 증거 | 조치 |
|---|---|---|---|---|---|
| 1 | 🔴 **P0** | **이의신청 재검토·확정에 leader 허용** — resolve가 final_score·finalized_at 확정까지 수행하므로 leader가 "KPI 최종 확정(admin 전용)"을 이의검토 경로로 우회 가능한 **권한상승** | rbac.yaml: 재검토=admin only, leader deny | `kpi.py:517` `_check_manager`(leader 포함), 확정 `kpi.py:564-565` | `review_objection`을 `_check_admin_only`로 교체하거나 rbac.yaml 개정(정본 확정 필요). kpi.py 상단 주석도 정정 |
| 2 | 🔴 **P0** | **팀 스코프가 user_team_history 미반영** — JWT 발급 시점 team_id == 대상자 현재 erp_team_id로만 판정. 분기 중 팀 이동자 KPI 부당 접근/접근 불가. 리더 본인 팀 이동도 재로그인 전까지 옛 팀 접근 | 08 §1.3·§5.4, rbac.yaml §113 (평가기간 실소속=user_team_history) | `kpi.py:188-197` (`UserTeamHistory` 테이블은 존재 `tables.py:697`, 읽지 않음) | `_check_team_scope`에 period_key 기준 history 조회 추가 |
| 3 | 🟡 P1 | **좌석 CRUD에 leader 허용** — 매트릭스는 admin 전용. 동일 도메인 office_layouts는 admin만이라 파일 간 비일관 | rbac.yaml: 좌석 배치 편집=admin only | `seats.py:254` `_ADMIN=("admin","super_admin","leader")` vs `office_layouts.py:27` | leader 제거 또는 매트릭스 개정 |
| 4 | 🟡 P1 | **KPI 배치 18:00/21:00 논리 미분리** — 동일 `_kpi_batch_job()` 이 두 시각 호출. 스펙 의도=18:00 정량만/21:00 AI만 | 08 §4.1 (D17) | `scheduler.py:264-277` | compute/draft 잡 분리 (ai_draft_enabled 폴백으로 기능은 동작 — 낮은 위험) |
| 5 | 🟡 P1 | **require_role에 super_admin 자동상속 부재** — 현재는 전 엔드포인트가 쌍으로 명시해 무결하나, 신규 엔드포인트에서 `require_role("admin")`만 쓰면 super_admin 차단되는 실수 지점 | rbac.yaml §12 "super_admin=admin 상위 호환" | `deps.py:53` | 자동 포함 로직 또는 린트 규약. (QA #17의 'core/deps.py 단일 상수화'도 미실시 — 모듈별 정의 잔존) |

---

## 2. 미구현 — 외부 의존 게이트 (코드 결함 아님, 진행 차단 요소)

| 항목 | 정본 | 현황 | 증거 |
|---|---|---|---|
| STT 자동초안 | D5 MUST → 00-decisions §H에서 P6 외부의존 이관 확정 | **501 스텁** (정합 — 폴백=수동 회의록+AI 요약 동작) | meeting_minutes.py, 14-spec §2.5 |
| LiveKit 실미디어 | D24, P5 | 토큰 발급·2단계 입장 게이트까지 완료, **미디어 릴레이·Egress 인프라 미가동** | livekit_client.py, VideoTileGrid 마크업 |
| 실 ERP kpi_results push | 03 §5.1~5.2 (D15/D17) | push 로직 완성, `erp_push_endpoint` 미설정 시 **mock 적재** — ERP `feature/virtual-office-integration` 브랜치 배포 대기 | `eod_push.py:104-114` |
| ERP 전체 대사(reconcile) | 03 §2.2 D18 (매일 00:00 hard-delete 감지) | **skeleton** — 증분 동기화(매시간)는 동작 | erp/sync.py (④트랙 실측; ⑥트랙 "완료" 주장은 미검증 일반화로 기각) |

## 3. 미구현 — 후순위 (로드맵 정합, 결함 아님)

- 다층 렌더·**층 전환**(층 선택기 = 정적 UI, `OfficeShell.tsx:205` 주석 명시) — P7-T2
- 20명 부하검증 (smoke는 2인 PASS) — P7-T4
- audit_log·kpi 5년 보존 파기 배치 (08 §7.3 D20-e) — 향후
- 공휴일 캘린더 (EOD 스킵은 토·일만) — P2 개선
- 모바일 알림 — COULD
- 조직도 편집기 잔여(React Flow 노드 편집·Undo) — P3

---

## 4. 부분 구현 잔존 (QA 27항목 중 부분수리 9건 + 화면 상세)

QA감사 27건 판정: **수리 18 / 부분수리 9** (전면 잔존 0)

| QA# | 항목 | 잔여 내용 | 증거 |
|---|---|---|---|
| 11 | 녹음/STT 동의 게이트 | 동의 테이블·**프론트 고지 배너는 구현**(`meetings/page.tsx:619-660`, D20-b) — LiveKit join 시 백엔드 동의 강제 여부만 미확인 | consent.py |
| 14 | 좌석 draft 격리 | 백엔드 draft→validate→deploy→**rollback API 완비**(`office_layouts.py:99-230`) — 프론트 롤백 버튼 UI 미확인 | — |
| 17 | 역할 집합 | 3원화 자체는 해소(전 모듈 admin+super_admin 일관) — 단일 상수화 미실시 + §1의 결함 1·3 잔존 | 본 문서 §1 |
| 19 | Trip/Report id 타입 (프론트 number vs UUID) | 재확인 필요 | frontend lib |
| 20 | 날짜 경계 KST | 프론트 `toISOString()` UTC 혼재 가능 — 공통 유틸 강제 필요 | work-log/work-status |
| 23 | 에러코드 한국어 매핑 | apiErrors 존재, 전 detail 코드 커버리지 미확인 | lib/api |
| 24 | attachments·issues | 테이블 컬럼만 존재, API 스키마·폼 미노출 | work_logs.py |
| 25 | ActionItem 4상태 표시 | enum 4상태 정의됨, 프론트 렌더 이진 여부 재확인 | tables.py:179-182 |
| 27 | ai_draft 구조 | 08 §6.2.2 구조(strengths[]/overall/percentile) vs 구현 평면 구조·daily 생성 여부 재확인 | ai_draft.py |

화면 상세 잔여(③트랙): 아바타 커스터마이징 UI 상세(§3.9), KPI 워크플로우 전용 페이지 vs /admin/kpi 병합 여부(§3.13), 우측 패널·3카드 행(D29 시안 B로 **의도적 hidden 확인** — 복원 여부는 제품 결정), 좌석 편집 팔레트 전체 도구.

---

## 5. 문서 결함 (코드가 아니라 문서를 고칠 것)

| # | 문서 | 문제 | 조치 |
|---|---|---|---|
| 1 | **01-prd.md** | 🔴 D28/D29 미반영 스테일 — "R3F+Blender 깊이합성" 서술 잔존(`:14,78,81`), §7 수용기준(깊이합성 픽셀정확·R3F<5s·IBL)이 폐기 기술 기준이라 **무효**. 00-decisions §J 배너 대상에서 01-prd 누락 | D29 배너 부착 + §7을 2.5D 기준(스프라이트 로딩·z정렬)으로 재정의 |
| 2 | 14-virtual-office-spec / 16-render-spike | 🟡 D29 피벗 미반영 스테일 (오프라인렌더 서술) | 배너 부착 또는 개정 |
| 3 | 15-realtime-server-spec | 이동검증 "8항목" → 실측 **9개**(checkMeetingCapacity 추가) | 숫자 정정 |
| 4 | rbac.yaml | 신규 기능 7종(trips/reports/chat/avatar/consent/audit/EOD) 매트릭스 미등재 | access_matrix 행 추가 |
| 5 | 01-prd 범위표 | chat(채널 채팅) 미등재 — 06 §3.17은 "Phase 7 후보 vs MVP 승인" **스코프 결정 미결** 상태로 구현이 선행 | 제품 결정 기록 후 등재 |
| 6 | 12-tasks.md | 일부 상태 표기 드리프트(P1 항목들 "구현중" 표기이나 완료 등 — 역방향 위주) | 상태 갱신 |
| 7 | 소청소 | `integrations/__init__.py` WA 주석 1줄 잔재 | 삭제 |

※ 역방향(문서가 코드보다 뒤처짐) 해소 확인: 공지(14-spec "신규 필요"→구현 완료), 셸 단일화, 출장·보고서(06 §3.15~3.16 후행 등재 완료), 04 v1.4 테이블 6종 등재.

---

## 6. 오탐 기각 기록 (감사 신뢰성)

| 주장 | 기각 근거 |
|---|---|
| "Colyseus 이동서버 미구현, P3=10%" (⑥ 초안) | `movement.ts:82-169`(9검증)·`proximity.ts:70-149`(LOS 포함 8검증)·`OfficeRoom.ts:212-427`·20Hz(`config.ts:9-11`) 실측. ⑥ 최종본에서 자체 정정 |
| "D24 근접 명시입장 미구현" (⑥ 초안) | `OfficeRoom.ts:350-384` 2m+정원 → 클라 명시 클릭 → FastAPI /join 2단계 |
| "presence TTL 30일 미구현" (⑥ 초안) | `scheduler.py:229-246` `_presence_purge_job()` |
| "business_trip 등 6테이블 04 미등재 / tscn_path 잔존 / notice.company_id 구현" (② 상세본) | 04 v1.4 `:1203,1232,1249,1301` 등재 확인 / `tables.py:1411` gltf_path만 존재 / Notice에 company_id 없음(문서 명시 의도) |
| "프론트 2.5D 뷰포트·office2d.ts 미존재" (⑤ 본체) | `OfficeViewport2D.tsx:112-952`·`lib/office2d.ts:1-222`·오프라인 폴백(`:141-142`) — ⑤ 하위 탐색이 라인 단위 실측 |

---

## 7. 권장 조치 순서

1. **P0 반나절**: §1-1(이의 재검토 admin 전용화 or 정본 개정) + §1-2(team scope history 반영)
2. **P1 1일**: §1-3 seats leader 정리, §1-4 배치 분리, §1-5 require_role 상속, QA 부분수리 9건 중 백엔드 몫(#24 attachments API, #11 join 동의 강제)
3. **프론트 마감 1일**: #14 롤백 버튼, #19/#20/#23/#25/#27 정합, 아바타 상세
4. **문서 반나절**: 01-prd D29 재정의(최우선), 14/16 배너, 15-spec 9항목, rbac.yaml 확장, chat 스코프 결정 기록
5. **외부 게이트 (코드 외)**: ERP kpi_results 배포 확인, LiveKit 인프라, STT 엔진 선정, reconcile 실장, 20명 부하 실측

---
*생성: 2026-07-13, 6트랙 병렬 감사 + 메인 세션 교차검증. 증거는 감사 시점 file:line. 선행 문서: qa-audit-2026-07-13.md(수리 전 상태), 본 문서(수리 후 잔존).*
