# Planning Loop Report — Round 1

**검증일**: 2026-07-02 · **모드**: Standard(ad-hoc 문서 맵) · **iteration**: 1/3
**입력**: docs/planning/00~13 + specs/(screens 7, domain, shared) + 12-tasks + 구현 코드(backend) + 배포 정본(onprem-docker.md)
**발견**: 139건 (P0 8 · P1 ~60 · P2 ~71) — 상세 클러스터: document-gap-report.md

---

## Scores (13항목 루브릭)

| # | 항목 | 점수 | 근거 | 수정 액션 |
|---|---|---|---|---|
| 1 | Product Clarity | **4/5** ✅ | 목표·페르소나·WON'T 명확(01-prd). 성공지표 일부 비측정(A1-07/08: "N회" 미정, 정성 기준 3건) | 지표 정량화(patch-01, P2) |
| 2 | Requirement Completeness ★ | **3/5** ❌ | **보안 NFR 섹션 부재**(A6-15) — 외부 공개 확정 후 요구 수준 미달. 계정잠금/브루트포스 0건(A6-16) | 01-prd §7 보안 수용 기준 + 02-trd §4.2 보강 (C2) |
| 3 | Technical Feasibility ★ | **4/5** ✅ | 스택 검증·스파이크 계획 존재. 국소 구현불가 2점은 데이터 갭으로 분류(C5) | — |
| 4 | User Flow Coverage ★ | **3/5** ❌ | 주요 성공/오류 흐름 양호(06 §4·5). **로딩 상태 전 화면 미정의, 3D WSS 단절 UX 부재**(A2-18), 일부 화면 흐름 06 본문 부재 | 06 §5.3 로딩/재연결 추가 (C7) |
| 5 | Data Model Fit | **2/5** ❌ | **정본 충돌 4건(C4: 좌석배정·좌표계·asset·이의신청 어휘)** + STT 필드 부재(C5) + resources.yaml 전면 노후(C6) | 정본 확정 → 04/05/07/yaml/코드 정렬 |
| 6 | UI/Screen Completeness | **3/5** ✅(경계) | 13화면 정의는 충실. YAML 6종 부재(C7), D11/D12 잔재 | screen-spec 패치 |
| 7 | Design System Applicability | **2/5** ❌ | 상태색 토큰만 존재. 타이포/간격/팔레트 무정의(A2-20) | "Tailwind 기본 테마=정본" 1줄 결정 또는 tokens.yaml (경량 해소 가능) |
| 8 | Task Executability ★ | **3/5** ❌ | 4요소 91%. **P0 갭 2건(클라이언트 네트워킹·인증 구현)**, 과대 9건, 모호 8건, 마이그레이션 계획 실효(A5-04) | patch-12 (C3, C11) |
| 9 | Testability | **3/5** ✅(경계) | 완료조건 대부분 측정형. 모호 8건 + V태스크 산출물 7건 누락 | patch-12 |
| 10 | Traceability ★ | **3/5** ❌ | MUST 8건 태스크 커버. SHOULD 1건(조직도 에디터) **PRD→로드맵→태스크 전체 끊김**(A1-01+A5-14), work_log UI 등 부분 끊김 | patch-10/12 |
| 11 | Consistency | **2/5** ❌ | **D21 무효 13곳(C1)**, 상태머신 어휘 2계열(C4-d), 02↔09 프로토콜 어휘 불일치(A4-03), 04↔07 asset 충돌 | C1·C4 정렬 |
| 12 | Scope Control | **4/5** ✅ | WON'T 6항목+단일조직 컷 명확, 잔재 수치 없음 | — |
| 13 | Implementation Readiness ★ | **3/5** ❌ | Phase 0 산출물 실존, 코드 시작됨. 그러나 하드페일 2건 해소 전 다음 Phase 착수 위험 | C3~C5 해소 후 Ready |

**핵심 7항목(★+1,3) ≥4 필요 → 5개 미달** · 비핵심 ≥3 필요 → 2개 미달(5, 7, 11 중 3개가 2점)

## 하드페일 판정

| 조건 | 판정 | 근거 |
|---|---|---|
| PRD 핵심 기능이 Tasks에 없다 | **FAIL** | MUST #1/#4 구성요소인 클라이언트 네트워킹(A5-01)·인증(A5-02) 태스크 0건 |
| Screens 데이터가 DB 설계에 없다 | **FAIL** | STT 필드(A4-15), objection D16 필드(A2-10), doors(A2-12) |
| 나머지 6개 조건 | PASS | User Flow↔Screens 커버, TRD↔Tasks 기술 충돌 없음(어휘 수준), MVP 컷 명확, 착수점 명확 |

## 종합 판정: **Not Ready → 수정 후 재평가 (Round 2)**

단, 갭의 성격이 좋음: **새 기획이 필요한 발산형 갭이 아니라, 이미 내린 결정들로 수렴시키는 정렬형 갭**이 대부분 (D21 개정 반영, 정본 4건 확정, 누락 태스크/YAML 추가). 1라운드 패치로 Ready 도달 가능 전망.

## Revision Routing (LOOP 6)

| 클러스터 | 대상 | 방법 |
|---|---|---|
| C1 배포 드리프트 | 00, 02, 09, 11, 13, 12, 06 | 직접 패치 (D21-r 개정 → 일괄 치환) |
| C2 보안 요구 | 01, 02 | 직접 패치 |
| C3+C11 태스크 | 12-tasks | 직접 패치 (신설 4~6개 + 상태 동기화 + 정정) |
| C4 정본 충돌 4건 | 00/04/05/06/07/08/10/12 | **사용자 정본 확정** → 직접 패치 |
| C5 STT 스키마 | 04 + tables.py | 직접 패치 + code-fix |
| C6 resources.yaml | specs/domain | 직접 패치 (04 기준 재정합) |
| C7 화면 YAML | specs/screens | screen-spec 방식 신규 3~6종 + 기존 3종 수정 |
| C8 KPI | 08, 11, 04 | 직접 패치 |
| C9 코드 | backend/app/models/tables.py 외 | code-fix + 테스트 |
| C10 로드맵 | 10 | 직접 패치 |
