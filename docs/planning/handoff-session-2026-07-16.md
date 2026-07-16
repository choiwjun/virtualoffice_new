# 핸드오프 — 2026-07-16 세션 (v2.2 — 에셋 잔여 3종 종결: typing·시간대 테마·스프라이트 세분화)

> 다음 세션이 이 문서만 읽고 바로 이어서 작업할 수 있게 쓴 인수인계 정본.
> 현재 HEAD = main `726a286` (origin 동기). 워킹트리 clean. 모든 검증 그린.
> 선행 핸드오프: handoff-session-2026-07-13.md (dev 스택 기동 절차 §2①은 그대로 유효 — dev_qa.db 픽스처 존재, 시드 불요).

---

## 1. 이 세션에서 끝난 것 (커밋 순)

| 커밋 | 내용 | 정본 |
|---|---|---|
| `1480cd7` | **캐릭터 typing 상태 납품** — horizon-characters.js v2.2(착석 타건: 손목 교대 freq=2 정수 사이클로 6f 루프 무이음새 + 타건 리듬 잔바운스), extract-chars.js 208프레임(idle6/walk8/sit6/typing6 × 8직군) 추출 QA 0건, typing 48장만 frontend 납품(기존 상태는 렌더러 수학 불변) | tools/asset-gen/README.md |
| `6837b67` | **그룹 스프라이트 세분화 잔여분 종결** — 팬트리 아일랜드(벤치/테이블/스툴3)·폰부스(스툴/패널, 바닥광→배경 흡수) 개별 아이템화 → 52→57장 WebP 0.50MB. z-합성 재현 QA샷 육안 검증 | 〃 (그룹 분리 이력) |
| `726a286` | **뷰포트 배선** — ①typing 버스트: `typingBurstAt()`(벽시계 위상, 9.5s 중 4s, userId 해시 분산) 착석 중 sit↔typing 교대 ②씬 시간대 테마: `SCENE_THEMES`(day/dusk/night) 씬 톤 래퍼 filter + 앰비언트 오버레이(z12000), 자동(07/17/20시 경계)+수동 순환 버튼 ③17-spec ✅주석 갱신 | frontend/lib/office2d.ts |

**중요 정정**: 메모리·백로그에 잔여로 남아 있던 "보드룸 그룹 스프라이트 세분화"는 **이미 `ad83361`(07-15)에서 완료돼 있었다**(보드룸·미팅·워크스테이션 의자 개별화). 이번 세션 실잔여는 팬트리·폰부스뿐이었음 — 스테일 메모는 정정 완료.

**검증 스냅샷**: `tsc --noEmit` 0 · `next build` 21 routes OK · 캐릭터 추출 자동 QA(투명도·발 접지 445±14·bbox) 0건 · **실화면 QA**(dev 3종 스택, alice): 내 자리로→착석→프레임 폴링 타임라인 `sit 5.5s → typing 4.0s → sit`(설계 일치), 시간대 자동 감지(저녁→야간 톤) + 석양/야간 스크린샷 확인, 레이어 z-합성 재현샷으로 팬트리/폰부스 전후관계 확인.

---

## 2. 다음 작업 (우선순위순)

### F. 사용자 육안 확인 (5분, 첫 착수 권장)
typing 버스트·시간대 테마·팬트리/폰부스 가림 — 헤드리스 검증은 끝났고 233Hz 실모니터 육안 확인만 남음. 야간 테마 톤 강도(brightness 0.84·오버레이 0.26~0.36)는 취향 캘리브레이션 여지 있음 → `office2d.ts SCENE_THEMES`만 만지면 됨(에셋 무관).

### A. 에셋 폴리시 소형 (각 반나절 이내)
- 캐릭터 소품(안경·헤드폰 등 직군 개성): horizon-characters.js 파라미터 → `node extract-chars.js` 재추출(208f 전체 재납품)
- 플레이트 소품(벽시계·아트월): horizon-scene.js 아이템 추가 → sprites/ 클린 후 `node extract-layers.js`
- 브랜드 월 파라미터(ACME/NOVA — 시안 §5): 렌더러 인자화

### C. 런타임 모듈 합성 + 좌석 편집기 (대형, 묶음 필수)
시안 A안 + **#14 좌석 편집기 layout-JSON 재설계(P7)를 반드시 묶어서** — 편집기가 모듈을 배치하면 뷰포트가 그대로 렌더. 착수 전 설계 문서부터. v2.1~2.2 레이어 합성으로 렌더 절반은 이미 실증됨.

### B. 베이스 씬 배치 변형 (대형 — C 이후 권장)
개발중심/협업중심/컴팩트 3종(시안 §1). 오늘 한 "시간대 테마"와 별개인 **배치** 변형. 변형마다 전체 파이프라인 재수행 필요: plate.js 파라미터화 → layout.json 변형 → horizon-scene.js 재앵커링 → 오클루전 재추출 → office2d.ts·realtime 지오메트리 동기 → seats 재시드 → scene-floor 테스트 재캘리브레이션. 런타임 층/배치 전환 개념(단일 SCENE_FLOOR)도 선행 설계 필요. **C의 layout-JSON 재설계가 끝나면 오히려 쉬워지므로 C→B 순서 권장.**

### D. 외부 의존 게이트 (변동 없음)
ERP kpi_results 브랜치 배포(erp_push_endpoint + eod_push `_transmit` 실경로) · LiveKit 인프라(실미디어·타일·Egress) · STT 엔진 선정(P6-T1) · 실배포망 부하 실측(현재 인프로세스 20인 p95 131ms까지).

### E. 유보
#21 announcement 스키마(멀티테넌트 시).

---

## 3. 구현 메모 (다음 세션 판단 근거)

- **typing 버스트 설계**: 서버에 typing 신호가 없어(프레즌스 7종뿐) 클라 로컬 판정. `Date.now()` 벽시계 위상이라 모든 클라이언트가 같은 아바타의 같은 타이밍을 봄. 상수 = office2d.ts `TYPING_CYCLE_S 9.5 / TYPING_ON_S 4.0`. 추후 실 typing 신호(채팅 입력 등)를 붙이려면 `typingBurstAt` 호출부(뷰포트 rAF 상태 판정)만 교체.
- **테마 구조**: 씬 톤 래퍼(absolute inset-0 + CSS filter)가 씬~아바타~마커~라벨을 포함, 프롬프트·미니맵·칩(z 22000+)은 밖. 필터 활성 시 래퍼가 스태킹 컨텍스트가 되지만 내부 z 상호 가림은 유지됨. 앰비언트 오버레이는 래퍼 **안** z12000(아바타 10150 위·마커 15000 아래), 테마별 개별 레이어 opacity 크로스페이드. `autoTheme` 초기값 'day' 고정 = SSR hydration 시각차 방지(마운트 후 재평가).
- **세분화 원리(재발 방지)**: 그룹 스프라이트의 baseline(z)은 픽셀 최저 접점 = 최전방 부재로 내려감 → 뒤 부재가 북측 근접 아바타를 잘못 덮는다. 아바타가 부재들 **사이**에 설 수 있으면 반드시 분리(폰부스 내부는 보행 가능이라 해당). 장애물 내부라 아바타가 못 들어가는 경우에도 남측 인접 보행 지점에서 오차가 남으므로 분리가 안전.
- **함정 4건**:
  1. 레이어 재추출 전 `frontend/public/office2d/layers/sprites/` **클린 필수** — 아이템 번호가 밀리면 고아 webp가 남는다 (extract-layers.js는 청소 안 함).
  2. **`generate.js all --final` 사용 금지**(v2 이후) — v1 폴백 아트가 v2 납품(horizon.png·캐릭터 PNG)을 덮어쓴다. 지오메트리만 필요하면 `node generate.js plate`(layout.json만 갱신). 그림 재납품 경로는 ai-plate/incoming 렌더러 + extract-chars.js / extract-layers.js.
  3. PS5.1에서 `git commit -m @'…'@` 히어스트링 **안에 큰따옴표**가 있으면 네이티브 인자 전달이 깨진다(pathspec 오류) — 따옴표 제거나 다른 인용부호로 우회.
  4. md 편집 시 훅이 docs/_html 전체(38파일)의 날짜 스탬프를 재생성 — docs 커밋에 함께 포함하는 것이 관례(28c37aa 선례).
- **실화면 QA 재현법**: dev 스택 기동은 07-13 핸드오프 §2① 그대로(dev_qa.db 존재, 시드 불요). typing 검증 = Playwright로 로그인→내 자리로→`img.vo-body`의 src 프레임명을 500ms 폴링(24회)해 sit/typing 타임라인 확인. 테마 검증 = `button[title*="씬 조명 테마"]` 순환 클릭 + 스크린샷.

## 4. 정본 문서 포인터

- 에셋 스펙·이행 현황: `17-asset-rework-spec.md`(✅ sit/typing·시간대 주석 갱신됨) + `tools/asset-gen/README.md`(수정 루프·그룹 분리 이력·함정)
- 좌표·애니 계약: `frontend/lib/office2d.ts` / 뷰포트: `frontend/components/OfficeViewport2D.tsx`
- 이동계 불변식(건드릴 때 필독): 0.035 < WAYPOINT_EPS(0.06) < 클리어런스(0.07), 착석 게이트 stillSec 0.35s — handoff 07-13 §3 + seat-reach-qa.ts

---
*작성 2026-07-16. 선행 핸드오프: handoff-session-2026-07-13.md.*
