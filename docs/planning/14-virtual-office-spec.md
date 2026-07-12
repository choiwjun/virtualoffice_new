# 14. 가상사무실 기능 기획 (재정의 · 정본)

> 🔵 **D28 피벗(2026-07-09) — 렌더 방식만 대체.** 기능·화면·상호작용 기획은 유효하나, "포토리얼 오프라인렌더+깊이합성" 전제는 **실시간 스타일라이즈드 R3F**로 교체(오클루전 자동, Blender 굽기 불필요). 정본 = **00-decisions §I(D28)**.

> 🟣 **v8.0 에셋 업그레이드(2026-07-10, D28.1).** 저폴리 v1.1 → **v8.0 통합본**(`docs/virtual_office_final_dev_complete_v8_0/`): V4 히어로 씬 + **리깅+애니 휴머노이드**(idle/walk/sit/typing 등 12클립). 이 기획의 아바타 동세·People 패널 상호작용은 이제 **실제 애니메이션**으로 구현된다. 상세 = 00-decisions §I(D28.1).

> 🟪 **v10.0 PBR 강화(2026-07-11, D28.2).** v8.0 → **v10.0 완제품 패키지**(`docs/virtual_office_complete_product_v10_0/`)로 교체. 씬·캐릭터 토폴로지와 rig(18조인트·12클립명 동일)는 v8과 같고, **모든 GLB에 PBR 텍스처 내장**(씬 텍스처 54→114장)이라 아바타·씬 재질감이 상승했다. 프론트는 `frontend/public/office/*.glb` 8종 파일 교체만으로 반영(로직 변경 0). 상세 = 00-decisions §I(D28.2).

> 2026-07-08 작성. 사용자 확정 디자인 시안 + 포토리얼 웹임베드 전환에 따른 **가상사무실 전면 재기획**.
> 이 문서는 가상사무실(3D 오피스) 화면과 그 전 기능을 **새 아키텍처 기준**으로 재정의한다.
> 정본 참조: [3d-design/design-style-analysis.md](../3d-design/design-style-analysis.md)(스타일), [3d-design/photoreal-web-strategy.md](../3d-design/photoreal-web-strategy.md)(렌더), 05-office-layout-schema.md, 08-kpi-logic.md(KPI 로직·메트릭), 09-realtime-collaboration.md, 00-decisions.md.

---

## 0. 핵심 전환 (Supersedes D26)

| 항목 | 기존(D26, 폐기 예정) | 신규(본 문서) |
|---|---|---|
| 3D 오피스 | WorkAdventure(2D 픽셀) **별도 앱**(:8090, 별도 OIDC 로그인) | **웹 앱 내 임베드** R3F 포토리얼 뷰포트 |
| 앱 구조 | 웹콘솔 + 새 탭 가상오피스 | **단일 통합 대시보드**(시안) — 가상오피스는 한 화면의 뷰포트 |
| 인증 | 콘솔 JWT + WA OIDC(이중) | **단일 세션**(콘솔 JWT 그대로 3D 진입) |
| 실시간 이동 | WorkAdventure back | **SkyOffice 이식**(Colyseus 권위 서버, 20Hz) |
| 렌더 | WA Phaser 2D | Blender 오프라인 렌더 배경 + R3F 아바타 깊이합성 |

> **정리 대상**: docker WorkAdventure 스택(wa-*), 사이드바 "가상 오피스 입장" 외부링크, WA OIDC 브리지 → 신규 구조 확정 후 제거.

---

## 1. 화면 구조 (시안 기준)

단일 통합 대시보드 = 좌 내비 + 중앙(3D 뷰포트 + 대시보드 3카드) + 우 패널. 상세 레이아웃은 design-style-analysis §3.

- **좌 내비**: 가상오피스 / 업무관리 / 업무현황 / 출장관리 / KPI평가 / 보고서 / 회의실예약 / 커뮤니케이션 / 인사·근태 / 설정 + 내 프로필.
- **중앙 상단 3D 뷰포트**: 포토리얼 아이소 오피스 + 아바타·프레즌스 HUD·미니맵·층선택·미디어바.
- **중앙 하단 3카드**: 오늘의 업무 · 나의 KPI 현황(게이지+지표바) · 진행중 화상회의(참석자 타일).
- **우 패널**: 사용자 목록(필터: 전체/사무실/회의중/외근·출장) · 오늘의 일정 · 공지사항.

---

## 2. 기능 명세 (7개 카테고리) + 현재 구현 상태

> 상태 범례: ✅ 백엔드 구현됨(실측) · 🟡 부분/신규프론트 필요 · 🔴 미구현/외부의존 · 🆕 신규 인프라

### 2.1 아바타 / 이동
| 기능 | 정본 | 상태 |
|---|---|---|
| 아바타 커스터마이징(5~10 템플릿, 이름/직급 HUD) | 06 §1.2 | 🟡 프론트 신규 |
| WASD/마우스 이동 + 로컬 예측 | 09 §1 | 🆕 이동서버 |
| 좌표 동기화 20Hz 서버 tick | 09 §5, D3/D22 | 🆕 SkyOffice 이식 |
| 서버 이동 검증 8항목(충돌·층·속도·권한·점유·정원) | 09 §5 | 🆕 |
| 상태 불일치 보정(>0.5m Lerp), 재접속 스냅샷 복구 | 09 §5 | 🆕 |
| presence 1~5초 DB 배치 push | 09 §5 | ✅ presence_store/stream 존재 |

### 2.2 프레즌스 (D13 · 7종)
| 상태 | 전이 | 상태 |
|---|---|---|
| offline/online/working/meeting/focus/away/external | 좌석도착→working, 회의입장→meeting, 5분무입력→away 등 | ✅ 7종 상태·store·SSE stream 구현. HUD/미니맵 시각화 = 🟡 프론트 |

### 2.3 좌석
| 기능 | 정본 | 상태 |
|---|---|---|
| 좌석 타입 fixed/free/temp/partner | 05 §1.2.6, D10 | ✅ 스키마·CRUD |
| 배정 분리(layout JSON ↔ DB assigned_user_id + history) | D10 | ✅ seats/seat-assignments/history |
| 자율좌석 클릭 점유 / 자동 반납(퇴근·장기 away) | 06 §3.11 | ✅ 백엔드 · 🟡 3D 클릭 UX |
| 고정좌석 제약, 착석 방향(facing), 이름표 | 05/06 | ✅ 데이터 · 🟡 시각화 |

### 2.4 회의실 / 화상 (LiveKit)
| 기능 | 정본 | 상태 |
|---|---|---|
| D24 명시적 입장(2m 근접→프롬프트→클릭) | D24 | ✅ meetings/join · 🟡 근접 트리거 UX |
| LiveKit 토큰 발급·연결 | D24 | ✅ livekit-token · 🔴 실 미디어릴레이(인프라) |
| 녹음·STT 동의 배너(D20-b) | D20-b | ✅ **consent API 구현(2026-07-08)** · 🟡 배너 UI |
| 회의실 타입 meeting/lounge/focus/phonebooth, 정원 | 05/09 | ✅ room 스키마 |
| 화면공유·녹화(Egress) | 09 §4 | 🔴 외부/인프라 |
| 회의 생명주기(scheduled→in_progress→completed) + 예약충돌검증 | D23 | ✅ meetings(409 충돌검증) |

### 2.5 회의록 / STT (D5)
| 기능 | 정본 | 상태 |
|---|---|---|
| 회의록 CRUD·확정·액션아이템 | 06 §3.5.2 | ✅ meeting-minutes/action-items |
| STT 자동초안(한국어 화자분리) | D5 | 🔴 **501 스텁 · STT 엔진 외부의존** |
| AI 요약 | Phase 7 | 🔴 외부(Claude) — KPI초안은 배선 완료 |

### 2.6 공간 구조 / 레이아웃
| 기능 | 정본 | 상태 |
|---|---|---|
| floor/zones/rooms/seats/furniture/colliders/spawn/exit | 05 전체 | ✅ 스키마·office-layouts CRUD |
| 문 개구부(D9), 유리벽, 마커 | D9 | ✅ 스키마 · 🟡 3D 렌더 |
| 레이아웃 검증(정밀 A* 도달성·충돌) | D12 | ✅ validator(AABB) · 🟡 A* 도달성 보강 |
| 층별 버전 관리·배포·롤백·라이브 동기화 | D12 | ✅ deploy/rollback/validate |
| 미니맵 | 06 §3.3 | 🟡 프론트 |
| **레이아웃→Blender 씬 렌더 파이프라인** | 신규 | 🔴 **신규(render-pipeline 재구축)** |

### 2.7 실시간 인프라
| 기능 | 정본 | 상태 |
|---|---|---|
| WSS 프로토콜(TCP, TLS, 순서보장) | D1 | 🆕 SkyOffice/Colyseus 기반 |
| 20Hz tick, move_request/world_update | 09 §5 | 🆕 |
| 근접 상호작용 검증 8항목(LOS 광선 등) | 09 §5 | 🆕 |
| JWT 인증(D4, 콘솔 세션 재사용) | D4 | ✅ JWT · 🟡 3D 핸드셰이크 연결 |
| 성능 SLA: p95<500ms, 동시 20(도그푸딩)/100(설계) | D22 | 🔴 부하검증 필요 |

### 2.8 대시보드 통합 패널 (같은 화면)
| 패널 | 데이터 | 상태 |
|---|---|---|
| 오늘의 업무 | work_log | ✅ work-logs API · 🟡 카드 UI |
| 나의 KPI(게이지+지표바) | kpi_result | ✅ KPI엔진+ai_draft · 🟡 게이지 UI · **매핑=§2.8.1** |
| 진행중 화상회의(참석자 타일) | meeting/participant | ✅ API · 🟡 타일 UI |
| 사용자 목록(상태필터) | presence/erp_user | ✅ API · 🟡 리스트 UI |
| 오늘의 일정 | meeting | ✅ API · 🟡 UI |
| 공지사항 | (신규 리소스) | 🔴 공지 모델 신규 |

### 2.8.1 KPI 위젯 ↔ 메트릭 매핑 (08-kpi-logic 정본 바인딩)

> 로직 정본 = [08-kpi-logic.md](./08-kpi-logic.md), 메트릭 어휘 정본 = 04-data-model §2.5. UI는 아래 매핑을 따르며 임의 점수를 만들지 않는다(정량은 결정론적 코드가 계산, AI는 서술만 — D14-e).
> design-style-analysis §4의 `87/100`·`9/10`은 **시안 목업 예시**일 뿐, 실제 표시값은 아래 메트릭에서 온다.

| UI 위젯 (design-style §4) | 바인딩 메트릭 (08 / 04 §2.5) | 형식 | 비고 |
|---|---|---|---|
| **도넛 게이지**(중앙 숫자 `NN/100`) | `collaboration_score` | 0–100 | 08 §1.2 합성 점수(구성비: 업무건수30·충실도25·회의록20·액션15·기록10). 헤드라인 = 이 값 |
| 지표바 ① | `work_completed_count` | 건수 | 완료 업무 건수(막대는 팀 벤치마크 대비 상대표시 권장) |
| 지표바 ② | `work_quality_score` | 0–100 | 업무 충실도 |
| 지표바 ③ | `minutes_authored_count` | 건수 | 회의록 작성 기여 |
| 지표바 ④ | `action_items_ontime_rate` | % | 액션아이템 기한 내 이행률 |
| 지표바 ⑤ | `report_fidelity_score` | 0–100 | 업무기록 충실도 |

- **표시 주기**: 대시보드 카드는 **daily 뷰**(period_type=`daily`, 당일 누적) 기본. AI 서술 초안·종합평가(상/중상/…)는 **분기(quarterly)에만** 존재하므로 카드에 표시하지 않고, "KPI평가" 화면(분기 상세)에서만 노출한다(08 §3·§6.2.2).
- **API**: 카드 = `GET /api/kpi/daily`(와이드포맷 집계, 08 §6.2.1). 분기 상세 = `GET /api/kpi/quarterly`.

### 2.8.2 KPI 워크플로우 화면 (좌내비 "KPI평가")

> 대시보드 3카드는 **읽기 전용 요약(글랜스)**이다. 아래 전체 워크플로우 화면 명세는 **06-screens.md 갱신에 위임**한다(D27 리부트 미반영분 — 후속 작업).

| 화면 | 역할 | 정본 |
|---|---|---|
| 분기 KPI 상세 + AI 초안 열람 | 직원 본인 열람 | 08 §6.2.2 |
| 관리자 검토·조정(±10%) | leader/admin | 08 §3.2 · §6.2.3 |
| 직원 이의신청(상태머신 none→submitted→reviewing→resolved) | 직원 | 08 §3.3 · §6.2.4 |
| 감사/이력 열람 | HR·감사 | 08 §7.1 |

---

## 3. 요약 판정 (기능 실현성)

- **데이터·비즈니스 로직 백엔드는 대부분 구축됨**(프레즌스 7종·좌석·회의·레이아웃·KPI·동의·EOD). 이번 세션에 AI초안·EOD·동의까지 추가.
- **신규 핵심 작업 3개**: ① 포토리얼 프론트(R3F + Blender, 깊이합성 스파이크) ② 실시간 이동서버(SkyOffice 이식) ③ 대시보드 셸 통합.
- **외부 의존(코드만으론 불가)**: STT 엔진(한국어 화자분리), 실 LiveKit 미디어/Egress, 실 ERP, 100명 부하검증.
- **정리 대상**: WorkAdventure docker 스택·외부링크·OIDC 브리지.

---

## 4. MVP 컷오프 (제안 · 확정 필요)

**In (MVP)**: 통합 대시보드 셸 + 포토리얼 뷰포트(고정 아이소, 1개 층) + 아바타 이동/프레즌스 7종 + 자율좌석 점유 + 회의실 명시입장+LiveKit 오디오 + 대시보드 3카드 + 사용자목록/일정/공지.

**Later**: STT 자동초안, AI 요약, 녹화(Egress), 다층 렌더, 레이아웃 편집기→실시간 재렌더, 100명 부하, 모바일.

**Out(이번 버전)**: 자유시점 풀3D, 멀티테넌트, VR.

---

## 5. 다음 문서 작업 (기획 진행 순서)

1. ✅ design-style-analysis.md (완료)
2. ✅ photoreal-web-strategy.md (완료)
3. ✅ 14-virtual-office-spec.md (본 문서)
4. ✅ specs/screens/virtual-office-3d.yaml v3.0 갱신 (2026-07-09 완료)
5. ✅ 15-realtime-server-spec.md (2026-07-08 완료)
6. ✅ render-pipeline 스파이크 계획서 = 16 §Part A (작성 + **PASS 2026-07-08, commit b4736b1**)
7. ✅ 00-decisions.md §H D27 결정 추가 + D26 폐기 명문화 (2026-07-08 완료)
8. ✅ 10-roadmap.md v3.1 재산정 (2026-07-09 완료 — 주 단위는 원칙대로 미확정 유지)
9. ✅ 06-screens.md §3.13 KPI평가 워크플로우 화면 (2026-07-09 완료)
