# 핸드오프 — 2026-07-13 세션 (전수조사 → 전량 수리 → D30 에셋 리셋 → v1 팩 납품)

> 다음 세션이 이 문서만 읽고 바로 이어서 작업할 수 있게 쓴 인수인계 정본.
> 현재 HEAD = main `980a903` (origin 동기). 워킹트리 clean. 모든 검증 그린.

---

## 1. 이 세션에서 끝난 것 (main 병합 순)

| Merge | 내용 | 정본 문서 |
|---|---|---|
| `191ee42` | **전수조사 후속 수리** — RBAC P0 2건(이의검토 admin 전용·팀스코프 이력) + P1 3건(좌석 leader 제거·kpi_18 잡 제거·super_admin 상속) + D17 익일귀속 + 역할상수 단일화 + 01-prd v4.1(D29 재정의)·rbac.yaml 8행·12-tasks v3.1 | spec-impl-gap-audit-2026-07-13.md |
| `794b01b` | **잔여 갭 클로저** — team_percentile(08 §5.4)+ai_draft 08 §6.2.2 구조 전환(#27 종결), audit 5년 파기·EOD 공휴일 배치, 20명 부하 인프로세스 PASS(p95=131ms), reconcile "미구현" 판정 오탐 정정 | 〃 §2·§4 조치현황 |
| `67af7a7` | **D30 에셋 전면 리셋** — 기존 팩·3D 유산 962파일 삭제(보존본 없음, git 이력만), 뷰포트 플레이스홀더 모드, 17-asset-rework-spec 신설 | 00-decisions §K |
| `980a903` | **v1 2.5D 에셋 팩 납품** — tools/asset-gen 프로시저럴 생성기, 플레이트(모듈 6종)+캐릭터 8직군×14프레임, layout.json 단일 소스 지오메트리(프론트·realtime 동기), ASSETS_READY=true | 17-asset-rework-spec.md + tools/asset-gen/README.md |

**검증 스냅샷**: backend pytest **343 passed/0 failed** · realtime **smoke 30 + scene-floor 12 PASS** · `next build` OK(23 pages) · 부하 20/20·p95 131ms · 합성 QA샷 육안 확인(`tools/asset-gen/out/composite-qa.png` — 재생성 가능).

---

## 2. 다음 작업 (우선순위순 — 여기서 바로 시작)

### ① 실화면 육안 QA (첫 착수 권장, ~30분)
v1 팩을 실제 /office에서 아직 안 봤다. dev 스택 기동:
```bash
# 터미널 1 — backend (시드 계정: alice@virtualoffice.local / password123)
cd backend && ./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
# 터미널 2 — realtime (HORIZON 씬층)
cd realtime && SCENE_FLOOR=horizon npm run dev
# 터미널 3 — frontend
cd frontend && npm run dev   # http://localhost:3000 → 로그인 → /office
```
체크리스트 (01-prd v4.1 §7 수용기준):
- [ ] 플레이트 로딩 < 3초, 화질(@2x) 확인
- [ ] 아바타 스프라이트 표시·idle/walk 애니·좌우 플립·이름표
- [ ] 클릭 이동: 보행영역 클램프, 가구(21개 장애물) 통과 불가, 유리벽 차단
- [ ] 회의실 근접(보드룸/글라스룸 2m) → 입장 프롬프트 → /join
- [ ] 설정 → 아바타 프리셋 8직군 미리보기·저장 → 뷰포트 반영
- [ ] 2인 동시(시크릿창 bob 로그인) 아바타 상호 표시
- 발견 이슈는 에셋이면 `tools/asset-gen/src/*` 수정 → 재생성 루프(아래 §3), 엔진이면 OfficeViewport2D.

### ② 에셋 v1.1 폴리시 백로그 (시안 잔여)
- **sit / typing 상태** (시안 §4의 4상태 완성): characters.js에 상태 추가 + 착석 시 뷰포트가 seat anchor에 스냅 — realtime `handleSit`·seats REST는 이미 있음. office2d.ts `AVATAR_ANIM`에 상태 추가 필요.
- 베이스 씬 변형(개발 중심/협업 중심/컴팩트 — 시안 §1): plate.js 파라미터화.
- 캐릭터 디테일(안경·헤드폰 등 소품), 플레이트 소품(벽시계·아트월).
- 브랜드 월 교체 파라미터(ACME/NOVA — 시안 §5): buildPlate({brand}) 인자화.

### ③ 2차 — 런타임 모듈 합성 (시안 A안, 큰 작업)
가구·모듈 개별 스프라이트 + 뷰포트 z-정렬 합성 + occlusion 마스크. **#14 좌석 편집기 layout-JSON 재설계(P7)와 반드시 묶어서** — 편집기가 모듈을 배치하면 뷰포트가 그대로 렌더하는 구조. 착수 전 설계 문서부터.

### ④ 유보·외부 게이트 (변동 없음)
- 유보: #21 announcement 스키마(멀티테넌트 시), ai_draft 구조 전환은 완료됨(#27 ✅)
- 외부: ERP kpi_results 브랜치 배포(→ `erp_push_endpoint` 설정 + eod_push `_transmit` 실경로), LiveKit 인프라(실미디어·타일·Egress), STT 엔진 선정(P6-T1), 실배포망 부하 실측

---

## 3. 에셋 수정 루프 (정본: tools/asset-gen/README.md)

```
src/plate.js·src/characters.js 편집
→ node generate.js plate|chars     (out/ QA 프리뷰 육안 확인)
→ node generate.js all --final     (실납품 + layout.json)
→ [배치 변경 시] layout.json → office2d.ts·realtime HORIZON 주입 (README §3 — meetingZones는 Scene 프로바이더 블록!)
→ cd realtime && npm test / cd frontend && npm run build
```

**함정 3개** (README에도 기록):
1. 루트 `.gitignore` `out/`이 layout.json을 삼킴 → `git add -f`
2. Demo 프로바이더에 meetingZones 오주입 주의 (같은 모양 블록 2개)
3. scene-floor 테스트 좌표는 배치 의존 — 배치 변경 시 재캘리브레이션

---

## 4. 알아야 할 맥락 (이 세션의 판단 근거)

- **D30 배경**: 사용자 판단 "3D 고집이 퀄리티를 해쳤다" → 기존 에셋 전량 폐기(보존 불요 확인받음), 2.5D 유지 + 재작업. 엔진(뷰포트·Colyseus·좌표계약)은 유지 — 검증돼 있었기 때문.
- **v1 팩 방식**: 사용자 시안(모듈형 2.5D 에셋 팩)을 B안(모듈로 조립→플레이트 굽기)으로 구현. 프로시저럴(코드 생성)을 택한 이유 = 톤·시점 정합의 구조적 보장 + 지오메트리를 그림과 같은 소스에서 산출(시안 §6 메타데이터 사상).
- **감사 교훈**: 서브에이전트 "미구현" 판정 오탐이 반복됨(Colyseus·reconcile·D24·TTL·14/16 배너 등) — **라인 증거 없는 주장은 직접 grep 재검증**이 정본 규칙.
- 이의신청 재검토는 admin 전용(leader ✗ — rbac.yaml·08 §7.1 일치 확인됨). KPI 배치는 21:00 단일(18:00은 EOD push 전용 — D17 원문 기준).

## 5. 정본 문서 포인터

- 전수조사·수리 이력: `spec-impl-gap-audit-2026-07-13.md` (조치현황 3차까지)
- 에셋: `17-asset-rework-spec.md` + `tools/asset-gen/README.md` / 결정: `00-decisions §J(D29)·§K(D30)`
- QA 계정·런북: `realtime-qa-runbook.md` / 부하: `realtime/scripts/load-sim-20.ts` (`npm run load-sim`)

---
*작성 2026-07-13. 선행 핸드오프: handoff-session-2026-07-12.md.*
