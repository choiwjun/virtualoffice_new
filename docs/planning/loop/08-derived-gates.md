# 파생 게이트 (Derived Gates) — 구현 완료 판정 기준

**생성**: 2026-07-02 (planning-loop-supervisor LOOP 9) · **소스**: 01-prd MUST 8 + SHOULD 3 (Round 1 수정 반영판)
**규약**: 다운스트림 빌더/검증자는 이 게이트를 **증거와 함께** 통과하기 전 "구현 완료" 선언 금지.
Hard = 통과/실패 이분법 · Metric = 수치 목표 · Domain = 도메인 원칙 준수 · Evidence = 요구 증거물.

---

## REQ-001: 3D 가상오피스 클라이언트 (MUST #1)
- **추적**: PRD §3 → 06-screens §1 → virtual-office-3d.yaml → P1-S1-*, P4-R1-T3
- **Hard**: Godot 4.3+ Forward+ 네이티브 빌드가 office_layout JSON에서 씬을 생성·렌더한다. 아바타 이동/좌석 착석/회의실 입장 상호작용 동작.
- **Metric**: GTX 1650급 60fps / Iris Xe급 30fps (D7·D22). 10명 동시 렌더 < 16.6ms/frame.
- **Domain**: 좌석 배정은 layout JSON이 아닌 DB(seat.assigned_user_id) 조회 (D10). 상태 뱃지 D13 7종.
- **Evidence**: fps 측정 스크린샷+사양 명시, 골든샘플 대조 체크리스트, 조작 데모 영상/GIF.

## REQ-002: ERP read-only 동기화 (MUST #2)
- **추적**: PRD §3 → 03-erp → P2-R1-T1/T2/T4 → backend/app/erp/
- **Hard**: users/teams/positions 동기화(upsert+soft-delete 멱등) + attendances/leaves read-through. 실 dailylog 연결 시 코드 무변경(ERP_DATABASE_URL만).
- **Metric**: 매시간 증분 + 00:00 전체 대사 스케줄 동작(D18). 동기화 실패 시 알림 훅 발화.
- **Domain**: ERP에 쓰기 0건(read-only), company_id 스코프 전 쿼리 강제, attendance_date 컬럼 사용(updated_at 없음).
- **Evidence**: pytest(현 15종 통과 유지) + 실DB 통합 테스트 1종 + 스케줄 실행 로그. ✅ 부분 선행 구현됨(수동 트리거까지).

## REQ-003: 좌석/배치 편집기 (MUST #3)
- **추적**: PRD §3 → 05-layout → seat-layout-editor.yaml → P3-R*
- **Hard**: Konva.js 2D 편집(웹 3D 미리보기 없음 — D11). 검증 ERROR 0건일 때만 배포 버튼 활성([무시하고 배포] 없음 — D12). draft→validated→deployed→archived 상태 전이.
- **Metric**: office_layout.schema.json 공식 스키마 검증 통과. 배포 후 데스크톱 클라이언트 반영.
- **Domain**: 좌표 2D top_left 미터(D25), 배정 데이터 layout JSON 비포함(D10).
- **Evidence**: 검증 실패→수정→배포 E2E 시나리오 테스트, WARNING-only 배포 케이스 테스트.

## REQ-004: 실시간 서버 (MUST #4)
- **추적**: PRD §3 → 09-realtime → P4-R1-T2/T3, P4-R2-*
- **Hard**: Godot 헤드리스 서버 권위(이동 검증·충돌 차단(OQ12 확정)·근접·회의실 점유), 클라이언트 WSS 접속+hello/resume 핸드셰이크(D4), 재접속 5초 내 스냅샷 복원.
- **Metric**: 검증 20명 동시(설계 100명, D22), tick 20Hz 유지, 아바타 동기화 E2E p95 < 500ms.
- **Domain**: presence는 서버 메모리 권위 + FastAPI 배치 push(D3). presence 좌표 30일 파기(D20-a).
- **Evidence**: 20명 시뮬레이션 부하 리포트(S3 스파이크 승계), p95 측정 로그, 재접속 테스트.

## REQ-005: 회의/화상 (MUST #5)
- **추적**: PRD §3 → 09 §LiveKit → meetings.yaml → P5-R1/R2
- **Hard**: LiveKit self-host(Docker) 화상 연결 — 3D 회의실 입장 시 자동 join. 예약+FCFS(D23). 외부 접속은 공개 엔드포인트 UDP 직결+TURN-TLS 443 폴백(VPN 없음).
- **Metric**: 사내 LAN 음성 지연 < 200ms / 외부 < 300ms 목표. 동시 2~3방.
- **Domain**: 녹음·STT 동의 배너 필수(D20-b). **선행 결정: OQ13(ERP 회의실 예약 관계) Phase 5 착수 전 확정.**
- **Evidence**: S1 스파이크 리포트(Godot↔LiveKit PoC), 지연 측정, 동의 플로우 캡처.

## REQ-006: 회의록 STT 초안 (MUST #5/D5)
- **추적**: PRD §3 → 08/09 → meetings.yaml(stt-draft-review) → P5-R4-*
- **Hard**: 녹음→STT→화자분리→초안이 meeting_minute.stt_draft에 저장, 검토·수정→finalized 흐름. 실패 시 수동 폴백.
- **Metric**: 한국어 발화자·액션아이템 누락률 < 5%(D22, 수동 전사 10회 대조).
- **Domain**: 녹음 파일 90일 보존 후 파기.
- **Evidence**: S2 스파이크 리포트, 누락률 측정표, E2E(회의→초안→확정) 테스트.

## REQ-007: KPI 산출+AI 초안+검토·이의신청 (MUST #6)
- **추적**: PRD §3 → 08-kpi → kpi-dashboard/kpi-objection.yaml → P6-R*
- **Hard**: 결정론적 코드가 정량 계산(같은 입력=같은 점수), AI는 서술 초안만(D14-e). 이의신청 none→submitted→reviewing→resolved(D15) 상태머신 동작. D16 스키마(period_type/period_key/final_score).
- **Metric**: 분기 100명 배치 완료. 이의신청 7일 창 강제.
- **Domain**: 접속시간·채팅수 지표 사용 금지(결과물 중심). work_completed_count=완료 전건(D14-a).
- **Evidence**: 동일 입력 반복 계산 재현성 테스트, 상태머신 전이 테스트, AI 초안이 점수를 변경하지 않음 증명.

## REQ-008: EOD ERP Push (MUST #6)
- **추적**: PRD §3 → 03-erp §5 → P6-R2-*
- **Hard**: 18:00 KST daily_status push(D17, run_id 멱등) + KPI 확정분 POST /api/kpi-results(ERP dev 브랜치 신설분). 실패 재시도+알림 훅.
- **Metric**: push 성공률 추적, 실패 시 익일 보정.
- **Domain**: ERP 쓰기는 이 두 경로만. daily_status_push.status 추적 테이블 기록.
- **Evidence**: 멱등성 테스트(중복 run_id), ERP 수신 확인 로그.

## REQ-009~011 (SHOULD, Phase 7): 층/구역 권한 · 회의록 AI 요약 · 조직도 에디터
- **Hard**: 각 기능 동작(다층 내비게이션 3층, 구역 role 제한, ai_summary 생성, org_group CRUD — ERP 팀=리프 불변).
- **Evidence**: Phase 7 검증 리포트(docs/verification/phase-7-report.md).

---

## 공통 게이트 (전 Phase)

| 게이트 | 기준 | 증거 |
|---|---|---|
| **HG-SEC 외부 공개 하드닝** | onprem-docker §3.3 체크리스트 전항목 — **도그푸딩 시작 전 완료 필수** (P2-R4-T1) | 포트 스캔 결과, rate-limit 동작 테스트 |
| HG-AUTH 인증 | 로그인+JWT 24h+role 가드, 실패 5회 백오프 잠금 | 401/403/잠금 테스트 |
| HG-TEST 테스트 | 각 Phase pytest green + 계약 스텁 해제분 통과 | pytest 출력 |
| HG-DATA 마이그레이션 | pre-prod 0001 규약 / 운영 후 autogenerate 리비전 | alembic 이력 |
| HG-BACKUP | pg_dump 일일 백업 + 복원 리허설 1회 (도그푸딩 전) | 복원 성공 로그 |

## 게이트 자가검증
- [x] 모든 MUST REQ에 Hard+Evidence 존재
- [x] 각 게이트 문서 추적 링크 보유 (수정된 Round 1 반영판 기준)
- [x] 이분법 판정 가능 (모호 표현 없음 — 측정치/파일경로/테스트 명시)
- [x] 선행 결정 의존 명시 (OQ13→REQ-005, 스파이크 S1~S3→REQ-004/005/006)
