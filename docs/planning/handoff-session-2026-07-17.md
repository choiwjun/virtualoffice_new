# 핸드오프 — 2026-07-17 세션 (A 에셋 폴리시 3종 종결 + C 설계 문서)

> 선행 핸드오프: handoff-session-2026-07-16.md (§2 우선순위의 A 전체·C 설계 단계를 이 세션에서 소화).
> dev 스택 기동 절차는 07-13 핸드오프 §2① 그대로 유효.

---

## 1. 이 세션에서 끝난 것 (커밋 순)

| 커밋 | 내용 | 정본 |
|---|---|---|
| `81ab08a` | **A 에셋 폴리시 3종 종결(v2.3)** — ①직군 소품: MANAGER 사각·DESIGNER 라운드 안경, DEVELOPER 오버이어 헤드폰, INTERN 사원증 랜야드(faceProps/badge, 발 앵커 불변, 208f 재추출 QA 0건, 변경 4직군 104f만 재납품) ②씬 소품: NE 벽시계(u0.55~0.60)·아트월 갤러리(u0.33~0.412) — 배경 흡수, **스프라이트 57장·manifest 완전 불변** ③브랜드 월 파라미터: horizon-scene.js `BRANDS`(HORIZON/ACME/NOVA) + `buildPlate({brand})`, 지오메트리 불변 검증, QA 스크립트 `brand-qa.js` | tools/asset-gen/README.md |
| `633442c` | **C 설계 문서 신설** — `18-module-composition-and-seat-editor.md`: 모듈 카탈로그 / scene-layout v2(미터·D25, 05-스키마 확장 profile) / 뷰포트 3단 폴백 렌더 / 지오메트리 코드젠(4곳 수동 주입 소멸) / 편집기 검증·배포 루프, M0~M4 단계·게이트. **B(배치 변형 3종)는 M4로 흡수 — 별도 대형 작업 소멸** + 17-spec ✅주석 | 18-module-…md |

**부수 정리**: 세션 시작 시 전 파일(245개) CRLF 드리프트 발견 — `--ignore-cr-at-eol` diff 0건 확인 후 워킹트리 복구, `core.autocrlf false` 고정. git identity(choiwjun) 리포 로컬 설정.

**검증 스냅샷**: `tsc --noEmit` 0 · `vitest` 11/11 · `next build` 23 routes OK · 캐릭터 자동 QA(투명도·발 접지 445±14·bbox) 0건 · 콘택트시트+개별 프레임(DEVELOPER 헤드폰/MANAGER 안경 sit/INTERN 랜야드) 육안 OK · 배경 webp 육안(시계·아트월 벽면 정착) OK · ACME/NOVA 렌더 OK · layers diff = background.webp 단독(오클루전 무영향) · buildPlate 브랜드별 geometry 동일성 OK.

---

## 2. 다음 작업 (우선순위순)

### F. 사용자 육안 확인 (5분) — 07-16 잔존 + 이번 세션분 추가
typing 버스트·시간대 테마·팬트리/폰부스 가림(07-16분) + **v2.3 소품·벽시계·아트월**(이번분). 실모니터 확인만 남음.

### C. 모듈 합성 + 좌석 편집기 — **설계 승인 → M0 착수**
18-문서 승인 후 M0(모듈 카탈로그 추출기)부터 순차. 단계·게이트는 18-문서 §4. 승인 포인트: 05-스키마 v2 profile 확장 방향, 코드젠(1단계) vs 런타임 fetch(2단계).

### B. 베이스 씬 배치 변형 3종 → **C-M4로 흡수됨** (독립 작업 아님)

### A 잔여 소형 (선택)
브랜드 월 실전환 배선: 뷰포트가 `renderHorizonLayers(brand)` 재추출본 또는 테넌트 설정을 소비하는 배선은 미착수(파라미터만 완성). #21 멀티테넌트와 함께 판단.

### D. 외부 의존 게이트 (변동 없음)
ERP kpi_results 배포 · LiveKit 인프라 · STT 선정 · 실배포망 부하 실측.

---

## 3. 구현 메모

- **소품 재발 방지**: 소품 변경 시 해당 직군 26f만 재납품(캐릭터 렌더러는 결정적 — 미변경 직군은 픽셀 동일). 벽면 데코(시계·아트월·액자)는 배경 레이어 흡수라 스프라이트 번호·baseline에 영향 없음 — **가구(items 배열)만 오클루전 대상**.
- **NW벽 함정**: 회색 파티션(obstacle 18)이 NW벽 v 0.456~0.686을 덮는다(기존 frame(0.52,0.555)도 사실상 가려짐). NW벽 데코는 이 범위 회피 — 그래서 아트월을 NE벽(u 0.33~0.412)에 배치했다.
- **브랜드 QA**: `cd tools/asset-gen && node brand-qa.js` → `out/brand-{acme,nova}-qa.webp`. extract 계열은 Windows 전역 playwright 의존(`node.exe`로 실행; WSL node 불가).
- **CRLF 재발 시**: `git diff --ignore-cr-at-eol --stat`이 비면 내용 무손실 — `git checkout -- .`로 복구. autocrlf는 리포 로컬 false 고정됨.

## 4. 정본 문서 포인터

- C 설계: `18-module-composition-and-seat-editor.md` / 에셋 이력·함정: `tools/asset-gen/README.md` + `17-asset-rework-spec.md`
- 좌표·애니 계약: `frontend/lib/office2d.ts` / 이동계 불변식: handoff 07-13 §3

---
*작성 2026-07-17. 선행 핸드오프: handoff-session-2026-07-16.md.*
