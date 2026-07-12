# 16. 렌더 스파이크 계획 + 가상사무실 재구축 로드맵 (정본)

> 🔵 **D28 피벗(2026-07-09) — Part A 깊이합성 스파이크는 "PASS 후 미채택(보관)"으로 갱신.** 스파이크는 기술적으로 성립했으나, 사용자 제작 스타일라이즈드 에셋으로 **실시간 R3F 단일 렌더**(깊이합성 불필요)가 더 단순해 그쪽을 채택했다. 로드맵의 "오프라인 배경렌더" 전제는 **실시간 glb 로드**로 대체(P1 이후 태스크에 반영 필요). 정본 = **00-decisions §I(D28)**.

> 2026-07-08 작성. D27(포토리얼 웹임베드) 착수 계획. Phase 0 스파이크 수용기준 + 이후 단계 재산정.
> 정본 참조: [3d-design/photoreal-web-strategy.md], 14-virtual-office-spec, 15-realtime-server-spec, 00-decisions D6/D27.

---

## Part A. Phase 0 스파이크 — 깊이합성 검증 (착수 전 필수 게이트)

> ✅ **PASS — 2026-07-08 (commit `b4736b1` "depth-composite 오클루전 검증 PASS").** 게이트 통과. 증거: `spikes/depth-composite/evidence/`(front/behind/scan/diag PNG + EVIDENCE.md), 산출물: `render-pipeline/` + `spikes/depth-composite/`(camera.json·office_bg/depth·R3F 데모). **다음 착수 대상 = P1(셸+데이터연결).**
>
> ~~**이 게이트를 통과하지 못하면 D27 전략 자체를 재검토한다.** 다른 코드 착수 금지.~~ (해제됨 — PASS)

### A.1 목표
Blender Cycles로 구운 정적 오피스 배경 위에, react-three-fiber 실시간 아바타가 **가구·유리벽 뒤로 픽셀 단위 정확히 가려지는가**(깊이합성 오클루전)를 실증.

### A.2 작업 항목
1. `render-pipeline/build_office.py`(재작성 — 2026-07-05 유실분): Blender 헤드리스에서 최소 오피스 씬(바닥·책상 1·유리벽 1) 구성, **직교(ortho) 아이소 카메라**로 렌더.
2. 패스 export: `office_bg.png`(color), `office_depth.png`(Z depth, 선형화), `camera.json`(ortho scale·행렬·near/far).
3. R3F 최소 씬: 배경 풀스크린 쿼드 + camera.json으로 **동일 직교 카메라 재현** + 테스트 아바타(GLTF 또는 캡슐).
4. 깊이합성 셰이더: 아바타 프래그먼트의 뷰공간 깊이 vs `office_depth` 샘플 비교 → 배경보다 뒤면 discard.

### A.3 수용 기준 — 판정 상세(2026-07-08 PASS, 2026-07-09 증거 실측 정정)
- [x] 아바타를 책상 **앞**으로 이동 → 온전히 보임. (픽셀 검증 6,297px)
- [x] 아바타를 책상 **뒤**로 이동 → 가려짐(감소율 27.3%, 전환점 23개). ⚠️**유리벽은 불투명 차폐물로만 검증** — 시안의 "유리 너머로 보임"은 §A.6 글래스 레이어 스파이크로 별도 검증 필요.
- [x] 카메라 좌표계 정합(좌표 드리프트 없음).
- [~] 아바타 조명 IBL 정합 — **미검증**(스파이크 아바타 = 파란 캡슐, NoToneMapping). 실제 GLTF 아바타 + IBL 검증은 P3 아바타 태스크에서 수행.
- [x] 스크린샷 증거 저장 → `evidence/{front,behind,scan_*,diag_*,spike_*}.png`.
- ⚠️ 배경/깊이 = **Python 더미**(간이 투영·역투영, Cycles Z-pass 아님 — EVIDENCE.md 명시). 원리 검증은 유효하나 실 Cycles 산출물 재검증 = P2-T1~T3에서 수행.

### A.6 잔여 검증 — 글래스 레이어 스파이크 (시안 유리 투과 대응, 신규)

> **시안 요구**: 유리 회의실 **안**의 아바타가 유리 너머로 보여야 함. 현 단일 깊이패스는 유리를 불투명 차폐물로 처리(정면 모순) → **2레이어 합성** 필요.
- 방식: Blender 렌더레이어 분리 — ① 불투명 패스(유리 제외: office_bg + office_depth) ② 유리 오버레이 패스(glass_overlay.png RGBA + glass_depth). R3F 합성 순서 = 배경 → 아바타(불투명 depth 가림) → 유리 오버레이(픽셀별 아바타 depth vs glass_depth 비교로 앞뒤 판정).
- 수용 기준: 유리 **안** 아바타가 유리 틴트 너머로 보임 / 유리 **앞** 아바타는 유리를 가림 / 불투명 가림(A.3)은 회귀 없음.
- 소요: 1~2일. **P2 착수 전 게이트**(실패 시 폴백: 회의실 유리를 개구부/로우월로 디자인 변경).

### A.4 실패 시 폴백
- 부분 실시간 3D(배경도 저해상 실시간) / 빌보드 스프라이트 아바타 / 시점 축소. → 전략 문서 갱신 후 재결정.

### A.5 소요: **3~5일**. 산출물: render-pipeline 최소본 + R3F 데모 + 증거 스크린샷 + 판정 리포트.

---

## Part B. 재구축 로드맵 (Phase 0 통과 이후)

> D6(45주 기준선)을 D27 아키텍처로 재편. 1인 개발 기준 상대 규모(주 단위는 스파이크 후 확정).

| Phase | 범위 | 핵심 산출물 | 상태 전제 |
|---|---|---|---|
| **P0 스파이크** | 깊이합성 검증 | render-pipeline 최소본 + 판정 | — |
| **P1 셸+데이터연결** | 통합 대시보드 셸(시안), 좌내비/우패널/3카드, 기존 백엔드 API 연결(KPI·업무·유저·일정) | 시안 픽셀 재현 UI(3D 뷰포트 자리 = placeholder) | ✅ 백엔드 대부분 존재 |
| **P2 렌더 파이프라인** | layout JSON→Blender 파라메트릭 씬 빌더, 1개 층 포토리얼 배경 렌더+깊이 | office_bg/depth 자동생성, R3F 뷰포트 배경 표시 | P0 통과 |
| **P3 이동서버** | Colyseus 이식(15번 스펙), 아바타 이동·좌표동기화 20Hz·이동검증8, 아바타 GLTF+애니 | 멀티유저 이동, 깊이합성 아바타 | P2 |
| **P4 프레즌스·좌석** | 7종 상태 HUD·미니맵·우패널 실시간, 자율좌석 클릭 점유/반납 | presence 라이브 시각화(백엔드 존재) | P3 |
| **P5 회의·화상** | D24 명시입장(2m 트리거), LiveKit 오디오/영상, 동의배너(구현됨), 화상 타일 UI | 회의실 입장→화상 | P4 |
| **P6 STT·AI(외부의존)** | LiveKit Egress→한국어 STT→회의록 초안, AI요약. KPI AI초안(배선됨) + **KPI 워크플로우 화면**(관리자 검토·조정·이의신청, 06 §3.13) | 회의록 자동화 + KPI 평가 사이클 | 외부 리소스 |
| **P7 정리·부하·하드닝** | WA 스택 제거, 다층 렌더, 20명 부하검증, 보안 하드닝, 편집기→재렌더 | 도그푸딩 릴리스 | — |

### B.1 이미 확보된 자산(재사용)
- 백엔드: 프레즌스7종·좌석·회의·레이아웃(D12)·KPI엔진+AI초안·동의·EOD·work-log·ERP sync·감사 (pytest 417+).
- 스키마: office_layout(좌석/벽/회의실/문/구역), 좌표계(top_left 미터, D25).

### B.2 신규/외부
- 신규: Colyseus 이동서버, R3F 뷰포트+깊이합성, Blender 렌더 파이프라인, 통합 셸 UI, 공지 리소스.
- 외부의존: 한국어 화자분리 STT 엔진, 실 LiveKit 미디어/Egress, 실 ERP DB, 100명 부하.

### B.3 정리 대상(D27)
- docker WA 스택(wa-back/play/map-storage/uploader/icon/redis), WA OIDC 브리지, Sidebar "가상 오피스 입장" 외부링크, 관련 Caddy 라우팅.

---

## Part C. 기획 문서 진행 체크리스트

- [x] design-style-analysis.md · photoreal-web-strategy.md · 14-virtual-office-spec.md
- [x] 15-realtime-server-spec.md · 16(본 문서) · 00-decisions D27
- [x] specs/screens/virtual-office-3d.yaml v3.0 (D27 반영 — 2026-07-09 완료)
- [x] 10-roadmap.md v3.1 D27 정합 정리 (2026-07-09 완료 — 주 단위 숫자는 원칙대로 미확정 유지)
- [x] 공지사항 리소스 데이터모델 추가 = 04-data-model §2.7 (2026-07-08~09 완료, specs 리소스·화면 yaml 포함)
- [x] 06-screens.md §3.13 KPI평가 워크플로우 화면 (2026-07-09 완료)
