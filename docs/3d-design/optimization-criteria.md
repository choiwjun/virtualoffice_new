# 리소스 최적화 기준 (optimization-criteria.md)

> 🔵 **D28 피벗(2026-07-09) — 최적화 축 재전환.** 배경이 "오프라인 렌더 이미지"라는 전제는 폐기. **D28에선 배경도 실시간 3D glb**이므로, 런타임 GPU 부담 = **씬 실지오메트리(가구·벽) + 아바타 glb + 실시간 라이팅**이다. 따라서 폴리곤/드로우콜/텍스처(KTX2)/인스턴싱/LOD 예산이 **배경에도 다시 적용**된다(깊이합성 셰이더·오프라인렌더 전제는 무효). 아바타 예산(8K~15K/명, 20명≤300K)은 유효. 정본 = **00-decisions §I(D28)**.

> 🟣 **v8.0 예산 갱신(2026-07-10, D28.1).** 히어로 씬 glb = **13.5MB(메시 1689)** → 웹 로딩용 **Draco/meshopt 압축 권장**(미압축 시 첫 로딩 부담). 캐릭터 = 스킨드 메시 + `AnimationMixer`(본 18개/명) → 스키닝 CPU/GPU 비용 추가 발생. 아바타 폴리곤 예산은 유효. 상세 = 00-decisions §I(D28.1).

> 🟪 **v10.0 예산 갱신(2026-07-11, D28.2).** PBR 텍스처 내장으로 개별 GLB 용량↑: 히어로 씬 **13.5→22.4MB(텍스처 54→114장)**, 캐릭터 **~0.13~0.63→~1.6MB/명(텍스처 0→15~24장 내장)**. 첫 로딩 부담↑ → **Draco/meshopt 지오메트리 압축 + KTX2 텍스처 압축**을 웹 배포 전 적용 권장(토폴로지·rig·폴리곤 예산은 v8과 동일). 상세 = 00-decisions §I(D28.2).

> 🟢 **D27 반영(2026-07-09) — 이 문서는 현행 아키텍처(R3F 오프라인렌더+깊이합성 웹임베드) 기준으로 재작성되었다.** D26(WorkAdventure 2D)+Godot 네이티브 3D 노선은 모두 폐기됨. **최적화 대상 근본 전환**: 배경은 **Blender Cycles 오프라인 렌더 이미지**라 런타임 폴리곤/드로우콜/GI 예산이 배경에는 적용되지 않는다. 따라서 런타임 GPU 부담 = **실시간 아바타(경량 GLTF) + 깊이합성 셰이더 + 후처리(N8AO/Bloom/SMAA)뿐**이며, 최적화 예산·컬링·LOD·측정 절차를 이 축으로 전면 재정의한다. Godot 실시간 예산(GTX1650 60fps·드로우콜·SDFGI·MultiMesh·VRAM BC 압축)·Godot 컬링/LOD API·Godot 측정도구는 모두 폐기. 현행 정본: **00-decisions §H(D27)** · 14-virtual-office-spec · 15-realtime-server-spec · 16-render-spike-and-roadmap · 3d-design/{design-style-analysis, photoreal-web-strategy}.

**문서 버전**: 2.0  
**작성일**: 2026-07-02 (초안) · **개정**: 2026-07-09 (D27 재작성)  
**담당**: 3d-engine-specialist  
**태스크**: P0-T0.5 — 리소스 최적화 기준 (D27: R3F 웹임베드 아바타·후처리 예산)  
**스택**: three ^0.168 · @react-three/fiber(R3F) ^8.17 · @react-three/drei ^9.115 · pmndrs/postprocessing  
**참조**: 00-decisions.md §H(D27), 16-render-spike-and-roadmap(§A.3 깊이합성 PASS), 15-realtime-server-spec(§7 SLA), 3d-design/photoreal-web-strategy(§2·§4), 05-office-layout-schema.md(§2.4·§3.4)

> 이 문서는 00-decisions.md §H(D27)의 정본 결정을 따른다. 충돌 시 00-decisions.md가 이긴다.

---

## 1. 최적화 대상의 근본 전환 (D27)

### 1.1 배경은 예산 대상이 아니다

D27에서 오피스 배경은 **Blender Cycles로 오프라인 렌더한 정적 이미지**(`office_bg.png`)와 **깊이맵**(`office_depth.png`)이다(photoreal-web-strategy §2). 배경의 가구·벽·조명·GI는 렌더 시점에 이미 픽셀로 구워졌으므로 **런타임에 폴리곤·드로우콜·GI 비용이 발생하지 않는다.** 배경 예산은 "렌더 시간(오프라인)"과 "이미지 파일 크기(다운로드)"의 문제이지, 런타임 GPU 예산의 문제가 아니다.

따라서 **런타임 GPU 부담 = 실시간 요소뿐**이다:

1. **실시간 아바타** — 경량 GLTF 메시(사람) N명, 애니메이션(idle/walk).
2. **깊이합성 셰이더** — 아바타 프래그먼트 뷰공간 깊이 vs `office_depth` 샘플 비교 → 배경보다 뒤면 discard(오클루전).
3. **후처리** — pmndrs/postprocessing 체인(ACES/AgX 톤매핑 · N8AO · Bloom · SMAA).
4. **배경 풀스크린 쿼드** — 텍스처 샘플 1회 수준(무시 가능).

최적화 예산·컬링·LOD·측정은 전부 이 실시간 축에 맞춘다.

### 1.2 런타임 성능 예산 (웹 아바타·후처리 기준)

| 항목 | 예산 | 비고 |
|------|------|------|
| **웹 프레임레이트** | 아바타 N명(도그푸딩 20명)에서 **60fps 목표 / 30fps 최저** | Full HD, 표준 노트북 GPU + 크로미움. stats.js로 측정 |
| **아바타 폴리곤** | 8K~15K 삼각형/명 (LOD 0), 다운로드 후 총합 관리 | 배경은 예산 무관 |
| **아바타 드로우콜** | 아바타·후처리·쿼드 합산 수십 회 수준 | 배경(쿼드 1)은 사실상 상수 |
| **후처리 패스** | N8AO + Bloom + SMAA (3~4 패스) | 프레임 예산의 주요 GPU 소비처 → 프로파일 대상 |
| **깊이합성 정확도** | 오클루전 경계 오차 **≤ 2px** | 16 §A.3, PASS(2026-07-08) |
| **E2E 이동 지연(SLA)** | 아바타 이동 p95 **< 500ms**, tick **20Hz(50ms)** | Colyseus 권위 서버(15 §7) |
| **초기 로딩** | 배경 이미지 + 깊이맵 + 아바타 GLTF 다운로드·디코드 시간 | KTX2/Draco 압축으로 관리(§4·§5) |

> "GTX 1650급 60fps / 내장 30fps" 같은 **Godot 데스크톱 네이티브 하드웨어 기준(D22)은 폐기**한다. D27은 웹(WebGL/브라우저)에서 도는 실시간 아바타·후처리 부담을 기준으로 삼는다. 런타임 예산의 절대 게이트는 하드웨어 등급이 아니라 **깊이합성 정확도(≤2px) + 웹 60fps + Colyseus p95<500ms** 세 축이다.

---

## 2. 아바타·후처리 드로우콜 (런타임 실시간 요소만)

### 2.1 집행 규칙 — three.js 인스턴싱 / 배경 제외

Godot MultiMesh 그룹핑(`furniture_builder.gd`)은 **폐기**한다 — D27 가구는 배경 이미지에 구워져 런타임 드로우콜이 없기 때문이다. 런타임 드로우콜의 집행 대상은 **실시간 아바타·후처리·배경 쿼드뿐**이다.

```
배경 풀스크린 쿼드      → 드로우콜 1 (상수)
아바타 N명(개별 GLTF)   → 명당 메시/머티리얼 수만큼 (수 명~수십 명)
동일 아바타 variant 다수 → three.js InstancedMesh로 묶어 1드로우콜 지향
후처리 N8AO/Bloom/SMAA  → 패스당 풀스크린 드로우콜
```

같은 아바타 variant가 다수일 때는 **three.js `InstancedMesh`(또는 drei `<Instances>`)**로 묶어 드로우콜을 줄인다(Godot MultiMesh의 웹 대응). 배경 가구는 이미 이미지라 인스턴싱 대상이 아니다.

### 2.2 런타임 드로우콜 구성 예시 (도그푸딩 20명)

| 그룹 | 대상 | 예상 드로우콜 |
|------|------|------------|
| 배경 풀스크린 쿼드 (깊이합성 머티리얼) | 1 | 1 |
| 아바타 (20명, GLTF) | 명당 1~3 (mesh/material) | 20~60 (variant 인스턴싱 시 대폭 감소) |
| 아바타 라벨·상태뱃지 (DOM/HTML 오버레이 권장) | — | 0 (DOM은 GPU 드로우콜 밖) |
| 후처리 (N8AO + Bloom + SMAA) | 패스당 1 | 3~4 |
| **합계** | | **수십 회 수준** |

> 가구·벽·구조물·조명·환경은 **배경 이미지에 포함**되어 런타임 드로우콜 0. Godot 시절의 "가구 200개 → 드로우콜 관리"는 D27에서 무의미하다.

### 2.3 개수 프록시·서버 파생 드로우콜 폐기

Godot 시절 서버가 asset 테이블에서 파생하던 `estimated_draw_calls`(distinct asset_id 수)와 "furniture_count > 500 거부" 개수 프록시는 **모두 폐기**한다. 런타임 드로우콜은 이제 배치가 아니라 **동시 아바타 수 + 후처리 패스 수**의 함수다. 배치(가구 수)는 런타임이 아니라 **오프라인 렌더 시간·이미지 용량**에만 영향을 준다(§6).

---

## 3. 폴리곤 예산 (실시간 아바타 전용)

배경 가구·벽·구조물·바닥·천장은 **배경 이미지에 구워져 런타임 폴리곤이 0**이다. 폴리곤 예산은 **실시간 GLTF 아바타에만** 적용한다.

### 3.1 아바타 폴리곤 할당

| 카테고리 | LOD 0 삼각형 | LOD 원거리 삼각형 | 비고 |
|---------|-------------|-------------|------|
| 아바타 (명당) | 8K~15K | 2K~4K | 사람 메시 + 간이 리깅 |
| 아바타 20명(도그푸딩) | 160K~300K | 40K~80K | 동시 표시 상한 기준 |
| 아바타 라벨·상태뱃지 | DOM/HTML 오버레이 권장 | — | GPU 폴리곤 밖(0) |
| 배경(가구·벽·조명 등) | **0 (이미지에 구움)** | 0 | 런타임 폴리곤 예산 무관 |
| **런타임 총 목표** | **≤ 300K (동시 20명)** | **거리 LOD 적용 후 대폭 감소** | 배경 제외 |

> Godot 시절의 "전체 씬 500K~1M"은 **가구·벽까지 실시간 렌더하던 전제**였다. D27은 배경이 이미지라 실시간 폴리곤 총량이 크게 줄어든다.

### 3.2 아바타 LOD (three.js API)

Godot `GeometryInstance3D.visibility_range_begin/end`는 **폐기**한다. 아바타 LOD는 **three.js `THREE.LOD`(또는 drei `<Detailed>`)**로 카메라-아바타 거리에 따라 메시를 스왑한다.

| LOD 레벨 | 폴리곤 비율 | 카메라 거리(월드 미터) | 적용 조건 |
|---------|------------|---------|---------|
| LOD 0 (Full) | 100% | 근거리 | 카메라에 가까운 아바타 |
| LOD 1 (Mid) | 50% | 중거리 | |
| LOD 2 (Low) | 25% | 원거리 | 화면 상 작게 보이는 아바타 |

- 고정 아이소 직교 카메라이므로 거리 구간은 `ortho_scale`(camera.json) 기준 월드 미터로 튜닝한다(원근 왜곡 없음).
- LOD 메시는 **Blender Decimate modifier**로 사전 제작해 GLTF에 담고, three.js는 스왑만 담당한다(런타임 자동 LOD 생성 없음).

---

## 4. 텍스처 예산 (배경 이미지 + 아바타 텍스처)

### 4.1 텍스처 구성

| 대상 | 해상도 | 포맷 | 비고 |
|------|--------|------|------|
| 배경 컬러 (`office_bg.png`) | 렌더 해상도 (예: 1920×1080) | PNG/WebP(무손실 톤 유지) | 화면 채우는 정적 배경. 압축은 다운로드 용량 관리용 |
| 배경 깊이 (`office_depth.png`) | 배경과 동일 해상도 | **무손실 필수**(깊이 정밀도) | 깊이합성 정확도(≤2px) 좌우 → 손실 압축 금지 |
| 아바타 텍스처 (근/원) | 1K~2K → 원거리 512 | **KTX2/Basis Universal** | 실시간 GLTF, GPU 압축 텍스처 |

> 배경은 벽·바닥·가구별 개별 PBR 텍스처가 아니라 **최종 렌더 결과 이미지 1~2장(+깊이)**이다. 벽/가구별 2K/1K/512 계층(Godot 전제)은 D27에서 불필요.
>
> **office_depth 규약** = 0=near(black) ‥ 1=far(white), **16bit** (camera.json `depth_encoding`, 스파이크 실측). 이 규약이 깊이합성 정확도(≤2px)의 전제다.

### 4.2 아바타 PBR 채널

실시간 아바타(GLTF 2.0 Metallic-Roughness)는 다음 채널을 포함한다. 배경은 이미 셰이딩이 구워져 PBR 채널이 없다.

| 채널 | 필수 여부 |
|------|---------|
| Base Color (Albedo) | 필수 |
| Normal Map | 필수 |
| Metallic-Roughness (ORM 패킹 권장) | 필수 |
| Emission | 발광체(뱃지 등)만 |

---

## 5. 웹 에셋 압축 (KTX2/Basis + Draco/meshopt)

### 5.1 압축 포맷 — 웹(WebGL) 전용

Godot BC(BC1/BC3/BC5)는 **데스크톱 네이티브 전제**이며 웹(WebGL)에서 지원되지 않으므로 **전면 폐기**한다. D27은 **웹 표준 GPU 압축**을 사용한다.

| 압축 | 대상 | 도구 | 비고 |
|------|------|------|------|
| **KTX2 / Basis Universal** | 텍스처(아바타 albedo/normal/ORM) | `toktx`, gltf-transform | GPU 트랜스코드(WebGL2). Godot 시절 "미사용"과 **정반대로 채택** |
| **Draco** | 메시 지오메트리(아바타 GLTF) | gltf-pipeline / gltf-transform | Godot에서 임포트 실패했으나 **three.js `DRACOLoader`로 정식 지원** |
| **meshopt** | 메시(대안/병행) | gltfpack | three.js `MeshoptDecoder` |

- three.js `GLTFLoader` + `KTX2Loader`(transcoder) + `DRACOLoader`/`MeshoptDecoder`로 로드한다(drei `useGLTF`가 래핑).
- **배경 깊이맵은 압축하지 않는다** — 깊이 정밀도가 깨지면 오클루전 경계(≤2px)가 무너진다.

### 5.2 다운로드/메모리 추정 (참고)

D27의 핵심 제약은 데스크톱 VRAM(4GB) 여유가 아니라 **초기 다운로드·디코드 시간**이다.

```
배경 컬러 이미지 1장 (1920×1080, WebP): 수백 KB~2 MB
배경 깊이 이미지 1장 (무손실 PNG):       수백 KB~2 MB
아바타 GLTF (Draco+KTX2, 명당):          수백 KB
────────────────────────────────────────
→ 첫 씬 진입 시 배경 2장 + 사용 중 아바타 GLTF만 로드.
  레이아웃/층별 렌더 산출물은 버전별 캐싱(photoreal-web-strategy §4).
```

---

## 6. 오프라인 렌더 예산 + 서버 검증 (05 §3.4 정합)

D27에서 배치(가구 수·방 수)는 **런타임 예산이 아니라 오프라인 렌더 시간·이미지 용량**에 영향을 준다. 서버 검증은 "런타임 드로우콜/폴리곤"이 아니라 **렌더 파이프라인 트리거·산출물 용량**을 관리한다.

### 6.1 파생 계산 주체 (재정의)

`office_layout` 확정 시 **FastAPI 서버가 렌더 파이프라인(Blender 헤드리스, photoreal-web-strategy §4)을 배치 트리거**한다. 클라이언트가 실시간 성능을 자기신고하던 Godot 모델은 폐기.

```
render_asset_count / render_area   → 오프라인 렌더 시간 추정(런타임 무관)
background_image_bytes             → office_bg.png + office_depth.png 다운로드 용량
concurrent_avatar_cap              → 동시 아바타 상한(런타임 폴리곤/드로우콜 실측의 근거)
```

- 배경 산출물은 층/레이아웃 버전별 캐싱 → 배치 변경 시에만 재렌더.
- 종전 `estimated_draw_calls`(distinct asset_id·MultiMesh 파생)와 폴리곤 배포 게이트는 **런타임과 무관해졌으므로 폐기**.

### 6.2 검증 게이트 (D27 3축)

| 축 | 게이트 | 근거 |
|------|-----------------|------|
| **깊이합성 정확도** | 오클루전 경계 오차 ≤ 2px | 16 §A.3 PASS(2026-07-08) |
| **웹 프레임** | 아바타 N명(도그푸딩 20명) 60fps 목표 / 30fps 최저 | 브라우저 devtools·stats.js |
| **이동 SLA** | Colyseus p95 < 500ms, 20Hz tick | 15 §7 |

> Godot 시절 "드로우콜 >200 / 폴리곤 >1.5M / VRAM >3.5GB 배포 차단"은 **전면 폐기**. 배경이 이미지가 되면서 이 임계값들은 근거를 잃었다.

---

## 7. 컬링 전략 (three.js — 오프라인 배경은 컬링 무의미)

### 7.1 배경은 컬링 대상이 아니다

배경은 화면을 채우는 **단일 풀스크린 쿼드(이미지)**이므로 오클루전/프러스텀 컬링 대상이 아니다. Godot의 동적 Occluder 베이크(`room_builder.gd`·`OccluderInstance3D`·`BoxOccluder3D`) 문제 자체가 **소멸**한다.

### 7.2 아바타 컬링·오클루전 (three.js)

- **오클루전(가림)** = 깊이합성 셰이더가 담당한다. 아바타 프래그먼트 깊이 > 배경 깊이면 discard → 가구/유리벽 뒤 아바타가 자연스럽게 가려진다(경계 ≤2px). Godot Occluder가 아니라 **깊이 비교 셰이더가 오클루전의 유일 메커니즘**이다.
- **프러스텀 컬링** = three.js `Object3D.frustumCulled`(기본 true)가 직교 카메라 절두체 밖 아바타를 자동 제외. 고정 아이소 뷰라 화면 밖 아바타(먼 좌석)는 자동 스킵된다.

---

## 8. 아바타 LOD (three.js — Godot 자동 LOD 폐기)

Godot 임포트 자동 LOD(`Meshes > Generate LODs`, `visibility_range_begin/end`)는 **폐기**한다. D27 아바타 LOD는 three.js API로 처리한다.

### 8.1 방식 — THREE.LOD / drei `<Detailed>`

- **Blender Decimate**로 아바타 LOD 메시(예: 100% / 50% / 25%)를 사전 제작 → GLTF에 담는다.
- three.js `THREE.LOD.addLevel(mesh, distance)` 또는 drei `<Detailed distances={[…]}>`로 카메라-아바타 거리에 따라 스왑.
- 거리 임계값은 고정 직교 카메라의 `ortho_scale`(camera.json) 기준 월드 미터로 튜닝(원근 왜곡 없어 단순).

### 8.2 예시 (R3F)

```tsx
// AvatarLOD.tsx — 거리 기반 LOD 스왑 (drei)
// @TASK P0-T0.5  @SPEC docs/3d-design/photoreal-web-strategy.md#6.1
import { Detailed } from '@react-three/drei'

<Detailed distances={[0, 8, 20]}>
  <AvatarMesh lod={0} />   {/* 근거리: 100% */}
  <AvatarMesh lod={1} />   {/* 중거리: 50%  */}
  <AvatarMesh lod={2} />   {/* 원거리: 25%  */}
</Detailed>
```

---

## 9. 품질 프리셋 (후처리 강도 기준)

Godot의 하드웨어 등급별 프리셋(GTX1650/RTX·SDFGI/ReflectionProbe·`lighting_manager.gd`)은 **폐기**한다 — 배경 조명은 오프라인에 구워졌고 런타임 GI 노드가 없다. D27 프리셋은 **후처리 강도**(pmndrs/postprocessing 패스)와 아바타 LOD를 조절해 프레임을 확보한다.

| 프리셋 | 목표 프레임 | 설정 |
|-------|---------|------|
| **High** (기본) | 60fps | N8AO + Bloom + SMAA 전부. 아바타 LOD 0~2, KTX2 풀해상 |
| **Balanced** | 45~60fps | N8AO 샘플 축소 + Bloom + SMAA. LOD 원거리 우선 |
| **Low** | 30fps 방어 | AO OFF/저품질 + Bloom 축소, SMAA→FXAA, 아바타 텍스처 하향 |

- 조절 주체는 R3F `<EffectComposer>` 패스 구성 + `THREE.LOD` 거리 튜닝.
- 배경 이미지 품질은 프리셋과 무관(이미 렌더된 결과).

---

## 10. 측정 절차 (웹 프레임 + 깊이합성 + Colyseus SLA)

Godot Debugger Monitor·GPU-Z·MSI Afterburner·Forward+·GDScript Profiler 기반 측정은 **전면 폐기**. D27은 **브라우저 도구**로 측정한다.

### 10.1 측정 환경

- **클라이언트**: 표준 개발 노트북 + 크로미움(Chrome/Edge), Full HD.
- **스택**: three ^0.168 · R3F ^8.17 · drei ^9.115 · pmndrs/postprocessing.
- **카메라**: 고정 아이소 직교(camera.json 재현) — 자유 회전 없음.

### 10.2 측정 시나리오

| 시나리오 | 내용 | 합격 기준 |
|---------|------|--------|
| S1. 배경만 | office_bg 쿼드 + 후처리, 아바타 0 | 60fps 여유 |
| S2. 기본 씬 | 아바타 10명 + 깊이합성 + 후처리 | ≥ 60fps 목표 |
| S3. 스트레스 씬 | 아바타 20명(도그푸딩 상한) + 깊이합성 + 후처리 | ≥ 30fps 최저 |
| S4. 오클루전 정확도 | 아바타를 책상/유리벽 앞·뒤 이동 | 경계 오차 ≤ 2px (16 §A.3) |
| S5. 이동 E2E | Colyseus 20Hz, 멀티유저 이동 | p95 < 500ms (15 §7) |

### 10.3 측정 방법

```
1. 프레임: 브라우저 devtools > Performance(프레임 타임라인) + stats.js 오버레이(FPS/frame ms).
2. GPU/드로우콜: Spector.js로 프레임 캡처 → 드로우콜 수·후처리 패스·텍스처 확인.
3. 오클루전: 아바타를 배경 깊이 경계 앞/뒤로 이동 → 스크린샷 비교로 경계 오차 ≤2px 확인
   (스파이크 evidence/{front,behind,scan_*}.png 방식 재사용).
4. 이동 SLA: Colyseus 클라이언트 계측(move_request→서버 반영 반영 타임스탬프) p95 산출.
5. 5분 연속 측정, 하위 5%(p5) 프레임 기록 → S2 ≥60fps / S3 ≥30fps 판정.
```

### 10.4 측정 도구

| 도구 | 용도 |
|------|------|
| 브라우저 devtools (Performance) | 프레임 타임·CPU/GPU 병목 |
| stats.js | 실시간 FPS·frame ms 오버레이 |
| Spector.js | WebGL 프레임 캡처(드로우콜·후처리 패스·텍스처) |
| 스크린샷 비교 (evidence/) | 깊이합성 경계 오차 ≤2px 검증 |
| Colyseus 클라이언트 계측 | 이동 E2E p95 SLA |

### 10.5 스파이크와의 연계

깊이합성 정확도(S4)는 **Phase 0 스파이크에서 이미 PASS(2026-07-08, 16 §A.3)**. 산출물 `spikes/depth-composite/`(camera.json·evidence)를 회귀 기준으로 삼아, 아바타·후처리 추가 시 경계 오차가 유지되는지 재검증한다.

---

## 11. 메모리 관리 (three.js dispose 패턴)

Godot `queue_free()`·`ResourceLoader` 캐시·ReflectionProbe 연쇄 해제는 **폐기**. three.js는 GC가 GPU 리소스를 자동 회수하지 않으므로, 씬/레이아웃 전환 시 **명시적 dispose**로 누수를 막는다.

```ts
// disposeScene.ts — 배경/아바타 교체 시
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose()
    const mat = mesh.material
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : []
    for (const m of mats) {
      for (const k in m) {
        const v = (m as any)[k]
        if (v && v.isTexture) v.dispose()   // albedo/normal/ORM/배경·깊이 텍스처
      }
      m.dispose()
    }
  })
}
```

- `geometry.dispose()` / `material.dispose()` / `texture.dispose()`를 명시 호출(GPU 버퍼 해제).
- 레이아웃 재렌더로 배경 이미지·깊이맵이 바뀌면 **이전 배경 텍스처를 반드시 dispose**.
- R3F는 언마운트 시 자동 dispose를 일부 수행하지만, 수동 로드(`KTX2Loader`/`useLoader` 캐시)·`InstancedMesh`는 명시 해제가 안전하다.
- 후처리 `EffectComposer`/렌더타깃도 교체 시 dispose.

---

## 12. 변경 이력

| 버전 | 일자 | 변경 내용 |
|------|------|----------|
| **2.0** | **2026-07-09** | **D27 재작성** — 최적화 대상을 "실시간 아바타+깊이합성+후처리"로 전면 재정의. 배경은 Blender Cycles 오프라인 렌더 이미지라 런타임 폴리곤/드로우콜/GI 예산 제외. Godot 성능예산(GTX1650 60fps·MultiMesh 드로우콜·SDFGI·Forward+) 폐기 → 웹 60fps 목표. VRAM BC(BC1/BC3/BC5) 폐기 → KTX2/Basis + Draco/meshopt. 컬링/LOD를 Godot API→three.js(THREE.LOD·frustumCulled·깊이합성 오클루전)로 교체. 측정도구 Godot Debugger/GPU-Z→devtools/stats.js/Spector.js. 게이트 3축(깊이합성 ≤2px·웹 60fps·Colyseus p95<500ms). dispose 패턴을 three.js로 교체 |
| 1.0 | 2026-07-02 | P0-T0.5 초안 — D7·D22 성능 기준, BC 압축, MultiMesh 집행 규칙, 서버 파생 검증(05 §3.4 정합), GTX1650/내장 측정 절차 |
