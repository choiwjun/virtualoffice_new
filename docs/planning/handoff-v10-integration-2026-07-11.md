# 핸드오프 — v10 PBR 에셋 통합 (2026-07-11)

> 다음 작업자가 **재조사 없이 바로 이어받도록** v10 통합 상태·검증·다음 액션을 정리한 인수인계 문서.
> 정본 결정 = `00-decisions.md §I(D28.2)`. 이전 상태 핸드오프 = `implementation-status-2026-07-06.md`(아카이브).

## 0. 한눈에 요약

- **한 일**: 런타임 에셋을 v8.0 → **v10.0 완제품(PBR 내장)** 로 교체하고 기획문서를 v10 기준으로 재정합화.
- **핵심 성질**: v10 씬/캐릭터는 v8과 **토폴로지·rig(18조인트)·클립명(12종) 동일**, GLB에 **PBR 텍스처만 내장**된 강화본 → **drop-in**(프론트 로직 변경 0).
- **검증**: 프론트 `npm run build` **EXIT=0**(18/18 라우트), 스왑 GLB 8종 전부 valid glTF·PBR 임베드, `asset-registry-v10.json` 교차대조 8/8.
- **라이브 반영면**: `/office`(주 앱, `page.tsx:493`)와 `/office-preview` **둘 다** `OfficeViewport`를 렌더 → 양쪽에 v10 적용됨.
- **진행됨(2026-07-11 후속)**:
  - ✅ **에셋 최적화 완료** — Draco 지오메트리 + WebP 텍스처. `frontend/public/office/` **~34MB → 9.68MB (−72%)**, 빌드 EXIT=0 (§3 P1).
  - ✅ **공지사항 기능 구현** — 기획문서 유일 미구현 갭(14-spec §2.8 🔴). 백엔드 `Notice` 모델+`/api/notices`(조회 전직원/작성·삭제 admin)+테스트 6종, 프론트 `/office` 대시보드 MOCK 제거·실 API 배선. pytest 15 passed(+전체 440 passed), 빌드 EXIT=0 (§3 P0).
- **미완(Later)**: 실브라우저 픽셀 육안 QA, KTX2/Basis(VRAM 절감, 네이티브 툴체인 필요), v10 패키지 중복 폴더 정리, 레이아웃 에디터 이식, **실시간 이동서버(SkyOffice/Colyseus, 🆕 신규 인프라)**, 외부 의존(STT·실 ERP·LiveKit 미디어).

## 0.1 공지사항(Notices) 구현 상세 (2026-07-11, P0)

- 백엔드: `models/tables.py`에 `Notice`(id/title/body/author/pinned/created_by + Timestamp·SoftDelete 믹스인, `notice` 테이블), `api/notices.py`(GET 목록 pinned·최신순 / POST admin / DELETE admin soft-delete), `main.py` 라우터 등록, `models/__init__.py` export.
- 프론트: `app/(protected)/office/page.tsx` — `MOCK_NOTICES` 제거, `notices` state + `fetchNotices()`(`GET /api/notices?limit=5`) + 우측 패널 실데이터 렌더.
- 테스트: `tests/test_notices.py`(인증필수·빈목록·employee 403·pinned 순서·soft-delete·validation), `test_foundation.py` 테이블 카운트 22→23.
- **관리 UI 완료(2026-07-11)**: `app/(protected)/admin/notices/page.tsx`(목록+작성 폼+삭제, admin 게이트) + `Sidebar.tsx` "공지 관리" 메뉴(admin/super_admin). → 공지 기능 **end-to-end 완성**(백엔드 API + 대시보드 조회 + admin 관리). 빌드 19/19 라우트 EXIT=0.

## 1. 변경 파일 (이번 세션, 리더 직접 수행)

| 파일 | 변경 | 비고 |
|---|---|---|
| `frontend/public/office/scene_v4.glb` | v10 PBR 씬 스왑 | 13.5→22.4MB, 텍스처 54→114장 |
| `frontend/public/office/{male,female,receptionist}_rigged.glb` | v10 PBR 히어로 캐릭터 3종 | 텍스처 0→15장 내장, ~1.7MB |
| `frontend/public/office/{male01,malecasual,female01,femalebiz}.glb` | v10 PBR 캐릭터 4종 | 텍스처 0→24장 내장, ~1.6MB |
| `frontend/components/OfficeViewport.tsx` | **헤더 주석/레지스트리 참조만** v10 갱신 | 로직 0 변경(diff의 대량 라인은 사용자의 기존 v8 미커밋 작업) |
| `docs/planning/00-decisions.md` | §I 에 **결정 D28.2** 신설(+47줄) | 런타임 에셋 정본 = v10 |
| `docs/planning/14-virtual-office-spec.md` | §0.5 v10 배너 | |
| `docs/planning/07-3d-visual-asset-pipeline.md` | v10 에셋 소스 배너 | |
| `docs/3d-design/asset-registry.md` | v10 런타임 레지스트리 배너 | |
| `docs/3d-design/optimization-criteria.md` | v10 예산 갱신 배너 | GLB 대형화 경고 |
| `docs/3d-design/scene-structure.md` | v10 씬/아바타 배너 | |

> ⚠️ 작업트리에는 이 세션 이전부터의 **사용자 미커밋 변경**(구 `virtual_office_3d_assets_full_v1_0/1_1` 삭제, `frontend/public/office/char_*.glb` 삭제, docs `_html/*` 등)이 다수 존재한다. 이번 세션은 위 표의 파일만 건드렸고 나머지는 **보존**했다.

## 2. 검증 재현 (그대로 복붙)

```bash
# (a) 스왑 GLB 유효성 + PBR/rig 확인
python3 - <<'PY'
import struct,json,glob
for p in sorted(glob.glob("frontend/public/office/*.glb")):
    with open(p,'rb') as f:
        ok=f.read(4)==b'glTF'; f.read(8)
        cl,_=struct.unpack('<II',f.read(8)); j=json.loads(f.read(cl))
    print(p.split('/')[-1], "valid",ok, "img",len(j.get('images',[])),
          "joints",len(j['skins'][0]['joints']) if j.get('skins') else 0,
          "anims",len(j.get('animations',[])))
PY

# (b) 프론트 빌드 (npm 사용, pnpm 금지 / /mnt/c라 수 분)
cd frontend && npm run build   # 기대: ✓ Compiled successfully, EXIT=0
```

기대치: 씬 img=114·joints=0·anims=0, 캐릭터 img=15~24·joints=18·anims=12. 빌드 18/18 라우트 통과.

## 3. 다음 액션 (우선순위·바로 실행 가능)

### P1 — 실브라우저 육안 QA (아직 안 함)
빌드는 통과했으나 **실제 렌더 육안 확인 미수행**. v10 PBR 재질이 IBL+ACES+Bloom과 잘 맞는지, 아바타 애니(12클립)·오클루전 확인 필요.
```bash
cd frontend && npm run dev        # http://localhost:3000/office-preview (인증 불필요)
# 또는 로그인 후 /office (주 앱). 계정: alice/bob/charlie @virtualoffice.local / password123
```
- WSL 헤드리스 캡처는 `frontend/_shot.mjs` 또는 `artifacts/webconsole/` 스크립트 참고(puppeteer 컨테이너 `--network host`).

### P1 — 웹 로딩 최적화  ✅ Draco + WebP 완료
**완료(2026-07-11)**: 8종 GLB를 **master→WebP 텍스처→Draco 지오메트리** 파이프라인으로 재생성. `frontend/public/office/` 합계 **~34MB → 9.68MB (−72%)**.
- 씬 `scene_v4.glb` 22.45→**6.06MB**(−73%), 캐릭터 각 1.6~1.75→**0.45~0.57MB**.
- 확장: `EXT_texture_webp` + `KHR_draco_mesh_compression`. rig(18조인트)·12클립·머티리얼 보존, `gltf-transform inspect` 디코드 검증, 빌드 EXIT=0.
- **배선**: Draco = 로컬 디코더 `frontend/public/draco/` + `OfficeViewport.tsx const DRACO='/draco/'`. WebP = **배선 불필요**(three r168 `EXT_texture_webp` 네이티브, 브라우저 디코드).
- 재현: `npx --yes @gltf-transform/cli@4 webp <master.glb> /tmp/w.glb && npx --yes @gltf-transform/cli@4 draco /tmp/w.glb frontend/public/office/<name>.glb`
- ⚠️ 압축본은 프론트에만. `docs/.../v10_0/` 원본은 비압축 마스터로 유지.
- 잔여 최대 절감은 KTX2/Basis(GPU 상주 VRAM↓, 네이티브 `ktx` 툴체인 필요) — 현 WebP로 첫 로딩은 충분히 경량화됨.

### P2 — v10 패키지 중복 폴더 정리
`docs/virtual_office_complete_product_v10_0/01_runtime_3d/models_pbr_v10/` 의 `characters_rigged/` 와 `characters_rigged_v8/` 는 **동일 8파일 미러**. 배포 시 하나만 유지 권장(용량·혼선).

### P3 — v10 런타임 앱 개념 이식 (Later)
`docs/virtual_office_complete_product_v10_0/11_complete_runtime_app/`(자유배치 레이아웃 에디터 + A* + 좌석 앵커)와 `12_layout_presets/`(프리셋 3종)는 **바닐라 Three.js 별개 스택**. R3F 프론트로 이식 시 좌석 앵커/프리셋 JSON을 `05-office-layout-schema` 스키마와 매핑. 우선순위 낮음.

## 4. 롤백 (v8.0로 되돌리기)
스왑 소스는 원본 유지됨. 필요 시:
```bash
S=docs/virtual_office_final_dev_complete_v8_0   # v8 원본 패키지 위치 확인 후
# (v8 파일들을 frontend/public/office/ 로 재복사) + OfficeViewport 헤더 D28.1로 복구
```
문서는 D28.1 배너가 그대로 있으므로 D28.2 블록만 제거하면 원복.

## 5. 함정 (이전 핸드오프에서 유효)
1. **npm 전용**(pnpm 금지). `/mnt/c` 빌드·설치 수 분.
2. CORS는 `localhost:3000`만 허용(127.0.0.1 차단).
3. `$team` tmux 워커는 이 환경에서 느린 `/mnt/c` 긴 툴콜(npm build) 동안 **claim 리스 만료로 스래싱** → 이번엔 리더 직접 수행이 확실. 대안: worktree 모드 또는 리더 직접.
4. 스크린샷 게이트 엔트로피: 캔버스(3D) 캡처는 검증기 통과 어려움 — 텍스트 오버레이 병행.
