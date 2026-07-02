# 기획 문서 갭 리포트 (document-gap-report)

**검증일**: 2026-07-02 · **검증 방식**: 6개 병렬 검사 에이전트 (A1 PRD/결정/로드맵 · A2 화면/명세 · A3 데이터 · A4 기술/3D/KPI · A5 태스크 · A6 신규결정 드리프트)
**총 발견**: 139건 — **P0 8건 · P1 ~60건 · P2 ~71건**
**개별 발견 원본**: 에이전트 산출 그대로 loop-state.json 참조. 본 리포트는 클러스터 통합본.

---

## Inventory (LOOP 0)

- 존재: docs/planning/00~13 (14종), specs/screens 7 + domain + shared, docs/api 2종, 배포 정본 docs/deployment/onprem-docker.md
- **missing 역할**: User Flow 독립 문서(06-screens가 부분 대체 — 로딩/단절 상태 공백), 웹 Design System(토큰 부재 — A2-20), Coding Convention
- Phase 0 완료 표시 7건 산출물 **전부 실존 확인** (위조 완료 없음 — A5 검사 6)

---

## 클러스터 요약 (심각도순)

### C1. 🔴 배포 확정(외부 공개) 드리프트 — D21 폐기 [P0×5]
> A6-01~13, A6-17, A6-21~27 (약 20건)

기획 시점 결정 **D21("사내 VM + 사내 PKI + Let's Encrypt 폐기 + VPN")**이 2026-07-02 확정(Linux 서버 PC + **VPN 없음 → 인터넷 공개** + 고정 IP + 도메인 추후 구매 + Let's Encrypt/Caddy)과 정면 충돌.
- 무효 서술 13곳: 02-trd(130, 411, 424-429, 514-520, 597-598, 610, 899), 09(559, 564, 567), 13(97, 106, 195, 400), 11(169), 00(D21)
- 12-tasks에도 "사내 PKI TLS" 태스크 2곳 (A6-21) — 그대로 구현하면 잘못된 산출물
- **수정 방향**: ① 00-decisions **D21 개정(D21-r)** → ② 나머지 문서 일괄 치환 → ③ 12-tasks에 "외부 공개 하드닝 태스크"(Caddy 단일 진입·rate-limit·fail2ban — onprem §3.3의 태스크화) 신설

### C2. 🔴 외부 공개 보안 요구 부재 [P1×3]
> A6-15, A6-16, A6-17

- PRD에 보안 비기능 요구 섹션 자체가 없음 (grep "보안|TLS" 0건)
- **계정 잠금/brute-force 방어 전 문서 0건**, 로그인 rate-limit 100req/min은 사실상 무방비
- **수정 방향**: 01-prd §7에 보안 수용 기준 추가 + 02-trd §4.2에 로그인 잠금/rate-limit 하향

### C3. 🔴 태스크 P0 갭 — 만들 수 없는 것 2개 [P0×2]
> A5-01, A5-02 (+A1-01, A5-14~17)

- **Godot 클라이언트 네트워킹 태스크 부재**: 서버(Phase 4)만 있고 클라이언트의 WSS 접속·이동 전송·원격 아바타 동기화 태스크 0건 → "10명 연결 성공" 검증 자체가 불가
- **로그인/인증 구현 태스크 부재**: JWT 계약만 있고 발급/미들웨어/로그인 화면 구현 태스크 0건
- 부가: 조직도 에디터(PRD SHOULD, 로드맵·태스크 모두 부재 — A1-01+A5-14), work_log 작성 UI(A5-15), presence 30일 파기 배치(A5-16), 팀 KPI 대시보드(A5-17)

### C4. 🔴 데이터 정본 충돌 — 구현이 갈라지는 지점 4건 [정본 확정 필요]
> A3-07/09, A4-07/11/13/15/25, A2-10/11

| # | 충돌 | 갈라진 문서 | 추천 정본 |
|---|---|---|---|
| C4-a | **좌석 배정 모델**: seat.assigned_user_id+seat_assignment_history(04·코드) vs seat_assignment(seat_db_id, released_at)(05·06·D10 문구) | 04/코드 ↔ 05/06/YAML | **04/코드** (이미 구현·마이그레이션 존재) → D10 문구·05·06·YAML 3종 수정 |
| C4-b | **좌표계**: room/seat coords {x,y,z} 3D(04·코드 주석) vs 2D top_left 미터(05, D25 정본) | 04 ↔ 05 | **05(D25)** — 04·코드 docstring 수정 |
| C4-c | **asset 스키마**: 04 §2.6(UUID PK, model/texture enum) vs 07 §5.3(VARCHAR PK, tscn_path·dimension·footprint_2d 등 "정본" 주장) | 04 ↔ 07 | **07 v1.1** (Phase 1 실사용 필드) → 04 §2.6 + 코드 Asset 모델 갱신 |
| C4-d | **이의신청 상태머신**: none→submitted→reviewing→resolved(04·08, D15) vs published→objection_filed→under_review→finalized(06·10·12) | 04/08 ↔ 06/10/12 | **04/08** (D15 + 코드 enum 일치) → 06·10·12 치환 |

### C5. 🟠 D5(STT 회의록) 구현 불가 — 데이터 모델 갭 [P1]
> A4-15 (+A2-14)

09의 STT 흐름이 요구하는 `meeting_minute.stt_draft`·`ai_summary`·`published` 상태가 04/코드에 전부 없음. MUST 기능이 현 스키마로 구현 불가.
**수정 방향**: 04 meeting_minute에 stt_draft/ai_summary 추가 + status enum 정리 → 코드 반영. meetings.yaml에 STT 기본 흐름+동의 배너(D20-b) 반영.

### C6. 🟠 specs/domain/resources.yaml 전면 노후 [P1×6, P2×4]
> A3-01/03/04/05/06/14/15/16, A2-10/13

kpi_result가 D16 이전 구스키마(17필드 불일치), presence 폐기 enum 10종, 미러링 금지 개인정보 필드 3종 잔존(D20-f 위반), user_team_history 리소스 누락, KST/UUID 표기 구버전. **화면·태스크 생성의 계약 파일이 가장 낡음.**
**수정 방향**: resources.yaml을 04 정본 기준 전면 재정합(1파일 집중 수정).

### C7. 🟠 화면 YAML 6종 부재 + D11 잔재 [P1×4]
> A2-01~06, A2-08/09, A4-01/02

- 06-screens에 정의된 13화면 중 YAML 없는 6개: **로그인(P1)·이의신청(P1)·동기화모니터링(P1)**·아바타·RBAC·자율좌석
- seat-layout-editor.yaml에 폐기된 3D 미리보기 컴포넌트/테스트 잔존(D11 위반), "무시하고 배포" 옵션 잔존(D12 위반), 02/11에도 3D 미리보기 문구 2곳
- 로딩 상태가 **전 화면 미정의**, 3D WSS 단절/재연결 UX 미정의 (A2-18)

### C8. 🟠 KPI 산식·원칙 충돌 [P1×3]
> A4-10/11/13/18, A1-15

- work_completed_count 정의 충돌(08: 전건 vs 04: result_url 필수) → **08(D14-a) 정본 추천**
- minutes_authored_count가 존재하지 않는 공동작성 구조 요구 → created_by 단독으로 축소 추천
- 11-tech-stack이 AI에 "정량화" 역할 + 유령 테이블(external_activities) 입력 부여 — **D14-e 정면 위반**
- weekly 주기 잔재 1곳(08:521)

### C9. 🟠 이미 구현된 코드의 수정 필요 [P1×3, P2×5]
> A3-02/11/12/13/19/20/21, (A3-22)

- **work_log.user_id가 CASCADE로 구현** — D18(평가 근거 영구 보존) 위반, RESTRICT로 변경 필요
- CHECK 제약 7종 + 좌석 배타성 부분 유니크가 코드에 전무
- self-FK relationship remote_side 역전 의심 (ErpUser.manager/OrgGroup.parent)
- KPI 점수 Float(문서는 NUMERIC — 감사 재현성), 타입힌트 datetime/date 3곳, 중복 인덱스 3곳
- office_layout.schema.json 공식 파일 미생성

### C10. 🟡 로드맵 스테일 표기 [P1×4, P2 다수]
> A1-02~05, A1-11~13, A1-15

D10 위반 샘플 JSON(assigned_user_id 인라인), D11 위반 "3D 미리보기" 검증 기준, 10명/20명 자기모순, presence 엔드포인트가 D3와 충돌(서버 권위 침해), kpi_date 유령 필드 등.

### C11. 🟡 태스크 품질 + 상태 동기화 [P1×5, P2 다수]
> A5-03~13, A5-18~23, A6-14

- 이미 구현된 ERP 어댑터/직원 API와 태스크 상태 불일치 3건(계획 외 구현 포함)
- 마이그레이션 계획(0002~0013 증분)이 실제(0001 create_all)와 전면 불일치
- 과대 태스크 9건, 모호 완료조건 8건, V태스크 산출물 누락 7건, 총계 오기(70→78)
- **ERP 회의실 예약 테이블 3종 중복 — 어느 문서에도 미등재** → OQ13 신규 등록 필요 (Phase 5 전 결정)

---

## 검사 결과 "이상 없음" 확인 (양호)

- ENet/GDNative/C#(.cs)/500명/26주 잔재 없음 (D1·D2·D22 정리 완료 상태)
- 라이트맵 배제(D7), tick 20Hz, p95<500ms, GTX1650/IrisXe 기준 — 02↔07↔09 일관
- KPI 산식 표본 4/5 계산 가능(work_quality/action_items/percentile), 접속시간·채팅 지표 잔존 없음
- 58주 일정 검산 일치, 간트 날짜 정합, WON'T 스코프 컷 명확
- YAML에만 있고 06에 없는 유령 화면 없음
- 의존성: 존재하지 않는 태스크 ID 0건, 순환 0건
