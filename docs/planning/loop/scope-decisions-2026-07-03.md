# 범위(Scope) 결정 — 시안 신규 항목 & spec↔시안 델타

**작성일**: 2026-07-03
**트리거**: 사용자 제공 3D 메인 오피스 시안(`design/screens/virtual-office-3d-reference.md`)이 기존 명세보다 넓은 내비(Events·Whiteboard·Files)와 UX 디테일을 포함 → scope 확정 필요.
**정본 근거**: `00-decisions.md`(신규 D26~D30 등록) · `01-prd.md §3`(MoSCoW) · `10-roadmap.md`(Phase #1~#7) · `06-screens.md` · `specs/screens/virtual-office-3d.yaml`
**원칙**: PRD 핵심통찰 "운영 허브, not 기능 과적(feature bloat)" + 기존 결정(Chat=Phase7 제한, 58주 일정)에 정합. **MVP는 린하게, 신규 기능은 Phase 7/향후로 이연**(가역적·확장 용이).

> **표기**: MoSCoW(MUST/SHOULD/COULD/WON'T) × Phase(#1~#7) × 판정([채택]/[이연]/[MVP밖]). Phase는 12-tasks.md의 #(단계).

---

## 1. 좌측 내비 항목 scope (시안 8종)

| 내비 | 판정 | MoSCoW | Phase | 근거 / 처리 |
|------|------|--------|-------|------------|
| **Office** (3D 뷰) | [채택] | MUST | #1/#4 | 기존 spec 핵심. |
| **Rooms** (회의실 목록) | [채택] | MUST | #4/#5 | `virtual-office-3d.yaml` sidebar-left. |
| **People** (참석자) | [채택] | MUST | #1/#4 | 우측 패널 + 사이드바. |
| **Settings** (아바타/알림/접근성) | [채택] | SHOULD | #1/#7 | 아바타 커스터마이징은 #1, 고급 설정 #7. |
| **Chat** | [MVP 제한] | SHOULD | #7 | **기존 결정 유지**(06 §1.2): MVP=회의 메모·근접 DM만, 본격 채팅=Phase 7. 내비 배지(2)는 알림 수준. |
| **Events** | [이연] | SHOULD | **#7** | 별도 개념 미정의. **MVP는 회의 캘린더(`meetings.yaml`)가 대체** — 내비 "Events"는 MVP에서 `/meetings` 캘린더로 연결, 전용 이벤트 허브(사내 행사/전사 일정 집계)는 Phase 7 신규 화면. |
| **Whiteboard** | [분리] | 물리=MUST / 디지털=COULD | 물리 #1·#3 / 디지털 **#7+** | **물리 화이트보드(3D 프롭)**: 기존 유지(05 `markers.whiteboard` + 07 에셋). **디지털 협업 화이트보드(Miro류 실시간 캔버스)**: 태스크 미정의·중량 기능 → COULD, Phase 7 이후(또는 향후). MVP 내비 미노출. |
| **Files** | [MVP 밖] | WON'T(58주 MVP) | 향후 | 기획 전무. 파일 링크는 `work_log.result_url` + 웹 콘솔로 충분. 범용 파일 저장소는 scope creep → **58주 완성 이후 재검토**. MVP 내비 미노출. |

**결론(내비 확정)**: MVP 노출 = **Office · Rooms · People · Chat(제한) · Settings**. Phase 7 추가 = **Events(전용) · Whiteboard(디지털)**. MVP 제외 = **Files**.
→ `00-decisions.md` **D26**, `virtual-office-3d.yaml` sidebar-left 반영.

## 2. UX/HUD 델타 (시안 → 명세 구체화)

| 항목 | 판정 | Phase | 결정 | 결정ID |
|------|------|-------|------|--------|
| **회의 입장 = 근접 + E키** | [채택] | #4/#5 | D24(명시적 입장) 유지. 트리거를 "Walk up + press **E** → 입장 다이얼로그 → 확인 → LiveKit 토큰". 클릭 병행. | **D27** |
| **인앱 화상 = 플로팅 드래그 패널** | [채택] | #5 | 06 footer 회의 컨트롤을 **플로팅 드래그 패널(그리드 타일 + 마이크/카메라/공유/리액션/손들기/종료)**로 구체화. E3 목표 HUD. | **D28** |
| **우측 People = 상태 섹션 그룹핑** | [채택] | #1/#4 | 기존 필터(all/online/meeting/focus/away)를 **섹션 그룹**(In Office / In a Meeting / Online / Away)으로 표현. 호스트 왕관 배지. | **D29** |
| **시각 품질 = 실사급 레퍼런스** | [채택] | #1 | `design/screens/virtual-office-3d-reference.md`를 Phase 1 골든샘플 아트/HUD 수용기준으로 고정(D22 60fps와 병행). | **D30** |
| **상단 조직 스위처 · ⌘K 검색 · 알림 벨** | [채택] | #1 | 기존 header-toolbar에 이미 포함(office 드롭다운·search·help) — 시안대로 알림 벨 추가. | (D26에 포함) |

## 3. MoSCoW 반영 (PRD §3 범위표 추가분)
- **SHOULD / #7**: Events 전용 화면, (기존) Chat 본격화, Whiteboard 디지털 협업보드(COULD)
- **WON'T(58주 MVP)**: Files 범용 파일 저장소 — "완성 이후" 재검토 열에 등록

## 4. 파급 문서 반영 계획 (downstream)
| 문서 | 반영 내용 | 상태 |
|------|----------|------|
| `00-decisions.md` | **D26~D30 신규 등록**(섹션 G) | ✅ 본 커밋 |
| `specs/screens/virtual-office-3d.yaml` | sidebar-left 내비 확정 + E키/화상패널/그룹핑 note | ✅ 본 커밋 |
| `implementation-handoff.md` | H3 "델타 재정합" → **결정 완료**로 갱신 + 본 문서 링크 | ✅ 본 커밋 |
| `01-prd.md §3` 범위표 | Events(SHOULD#7)·Whiteboard디지털(COULD#7)·Files(WON'T) 행 추가 | ⏳ 후속(제안) |
| `12-tasks.md` Phase 7 | Events 화면·Whiteboard 디지털 태스크 신설 | ⏳ 후속(제안) |
| `06-screens.md` | 좌측 내비·화상 패널·E키 서술 정정 | ⏳ 후속(제안) |

> ⏳ 후속 3건은 SSOT(00-decisions)에 결정이 박혀 있으므로 언제든 일괄 propagate 가능. 본 문서가 그 근거다.

## 5. 승인 포인트 (사용자 조정 가능)
아래 3건은 **린 MVP 기본값**으로 결정했으나, 제품 오너 판단으로 상향 가능:
1. **Files** → 현재 WON'T(MVP). "파일 공유가 MVP 필수"면 SHOULD/#7로 상향.
2. **Whiteboard 디지털 협업보드** → 현재 COULD/#7+. 회의 핵심 UX로 본다면 #5로 상향(단, 실시간 협업 캔버스는 +공수).
3. **Events 전용 화면** → 현재 #7. MVP에서 회의 캘린더로 충분하면 그대로, 전사 일정 허브가 필요하면 #7 유지.
