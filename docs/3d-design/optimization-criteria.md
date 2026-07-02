# 리소스 최적화 기준 (optimization-criteria.md)

**문서 버전**: 1.0  
**작성일**: 2026-07-02  
**담당**: 3d-engine-specialist  
**태스크**: P0-T0.5 — 3D 씬 구조 및 asset 레지스트리 설계  
**참조**: 00-decisions.md(D7·D22), 07-3d-visual-asset-pipeline.md(§1.2·§6), 05-office-layout-schema.md(§1.2.13·§3.4)

> 이 문서는 00-decisions.md의 정본 결정을 따른다. 충돌 시 00-decisions.md가 이긴다.

---

## 1. 기준 사양 및 성능 목표 (D22)

### 1.1 기준 사양

| 등급 | GPU | 목표 FPS | 해상도 |
|------|-----|---------|--------|
| **기준 사양** | GTX 1650급 | **60 fps** | Full HD (1920×1080) |
| **내장 그래픽** | Intel Iris Xe급 | **30 fps** | Full HD |

> "RTX 4060 이상" 요구는 폐기됨(D22). 기준 사양은 GTX 1650급 60fps다.

### 1.2 핵심 성능 예산

| 항목 | 예산 | 비고 |
|------|------|------|
| **드로우콜** | 100~200회 | 동일 asset_id → MultiMesh 1드로우콜 계상 |
| **폴리곤** | 500K~1M 삼각형 (LOD 포함) | 전체 씬 |
| **VRAM** | BC 압축 후 예산 이내 | GTX 1650: 4GB VRAM 내 |
| **시스템 메모리** | 2GB 이하 | Godot 엔진 포함 |
| **초기 씬 로딩** | 3초 이내 | 클라이언트 시작 후 첫 오피스 씬 |
| **구역 전환** | 1초 이내 | 층 간 이동 등 |

---

## 2. 드로우콜 예산 (100~200회 이내)

### 2.1 집행 규칙 — MultiMesh 그룹핑

드로우콜 예산의 집행 주체는 **씬 빌더(`furniture_builder.gd`)의 MultiMesh 그룹핑 로직**이다(05 §5.1, 07 §6.2).

```
동일 asset_id 가구 N개 → MultiMesh 1드로우콜
서로 다른 asset_id M개 → M드로우콜
```

따라서 **같은 책상 100개는 드로우콜 1회**이고, 서로 다른 종류의 가구 100개는 드로우콜 100회다.  
배치 계획 시 에셋 종류의 수(distinct asset_id 수)를 드로우콜 기준으로 관리한다.

### 2.2 드로우콜 구성 예시 (표준 오피스 1층)

| 그룹 | distinct asset_id 수 | 예상 드로우콜 |
|------|---------------------|------------|
| 책상(desk_standard) | 1 | 1 |
| 회의실 가구 세트 | 3~5 | 3~5 |
| 라운지 가구 | 3~4 | 3~4 |
| 소품(캐비닛, 프린터 등) | 4~6 | 4~6 |
| 구조물(브랜드월, 파티션) | 3~5 | 3~5 |
| UI 3D(상태뱃지, 라벨) | 2~3 | 2~3 |
| 아바타 (10명) | 1~3 (variant) | 2~6 |
| 조명·환경 | — | 5~15 |
| 충돌체·파라메트릭 벽 | — | 10~20 |
| **합계** | | **33~65 (여유 있음)** |

200드로우콜 한도는 `estimated_draw_calls`(서버 파생값)가 넘으면 FastAPI 검증에서 **ERROR**로 배포 차단된다(05 §3.4).

### 2.3 개수 프록시 폐기 (D7·D12 정합)

종전의 "furniture_count > 500 거부" 같은 **개수 기반 성능 프록시는 폐기**한다.  
성능 한도는 asset 테이블 `polygon_count`에서 파생한 **폴리곤/드로우콜 실측 기반값**으로 판정한다(05 §3.4).

---

## 3. 폴리곤 예산

### 3.1 카테고리별 폴리곤 할당

| 카테고리 | LOD 0 삼각형 | LOD 2 삼각형 | 비고 |
|---------|-------------|-------------|------|
| 아바타 (10명) | 10K × 10 = 100K | 2.5K × 10 = 25K | LOD 2 기준 |
| 대형 가구 (데스크 블록, 소파) | 15K~40K/개 | 4K~10K/개 | |
| 소형 가구 (의자, 캐비닛) | 5K~15K/개 | 1.5K~4K/개 | |
| 구조물 (브랜드월, 파티션) | 2K~8K/개 | 0.5K~2K/개 | |
| 파라메트릭 벽 (room 경계) | ~1K/세그먼트 | ~0.2K/세그먼트 | 런타임 생성 |
| 바닥·천장 메시 | 2K~4K/층 | 0.5K~1K/층 | |
| UI 3D (뱃지, 라벨) | 0.1K~0.5K/개 | 동일 | 극소 폴리곤 |
| **전체 목표** | **500K~1M** | **100K~300K (LOD 적용 후)** | |

### 3.2 LOD 레벨 규칙

Godot 4 `GeometryInstance3D.visibility_range_begin/end` 사용.

| LOD 레벨 | 폴리곤 비율 | 거리 범위 | 적용 조건 |
|---------|------------|---------|---------|
| LOD 0 (Full) | 100% | 0~10m | 근거리 상세 |
| LOD 1 (High) | 50% | 10~20m | 중거리 |
| LOD 2 (Medium) | 25% | 20~50m | 원거리 |
| LOD 3 (Low) | 10% | 50m 이상 | 매우 먼 거리 |

- Godot 4 임포트 설정의 **자동 LOD 생성**을 기본으로 활성화한다.
- 수동 생성이 필요한 경우 Blender Decimate modifier 사용.

---

## 4. 텍스처 예산

### 4.1 텍스처 해상도 계층

| 거리 | 해상도 | 적용 대상 |
|------|--------|---------|
| 근거리 (< 5m) | 2K (2048×2048) | 벽·바닥·천장·대형 구조물 |
| 중거리 (5~20m) | 1K (1024×1024) | 데스크·파티션·가구 |
| 원거리 (> 20m) | 512×512 | 소형 악세서리·전자기기 |

### 4.2 PBR 채널 구성

각 에셋은 최소 다음 텍스처 채널을 포함한다(glTF 2.0 Metallic-Roughness 기준):

| 채널 | 파일명 패턴 | 필수 여부 |
|------|-----------|---------|
| Base Color (Albedo) | `{slug}_albedo.png` | 필수 |
| Normal Map | `{slug}_normal.png` | 필수 |
| Roughness | `{slug}_roughness.png` | 필수 |
| Metallic | `{slug}_metallic.png` | 필수 (값이 0이면 단색 허용) |
| AO (Ambient Occlusion) | `{slug}_ao.png` | 선택 |
| Emission | `{slug}_emission.png` | LED·발광체만 |

---

## 5. VRAM 압축 (BC 압축) 설정

### 5.1 Godot 임포트 설정

**데스크톱 네이티브 배포**이므로 BC(Block Compression) 방식만 사용한다.

| 포맷 | 적용 텍스처 | 압축율 |
|------|-----------|------|
| BC1 (DXT1) | Opaque RGB (Base Color) | ~6:1 |
| BC3 (DXT5) | RGBA (투명도 포함 텍스처) | ~4:1 |
| BC5 | Normal Map (RG 채널) | ~4:1 |

설정 경로: `Import > Compress > Mode = VRAM Compressed`  
GPU에서 자동 디코드 → VRAM 절약.

**미사용 형식**:
- WebP, Basis Universal, ASTC — WASM export 미사용(D11), 모바일 미지원
- Draco / meshopt — Godot 4 임포트 실패(D8)

### 5.2 VRAM 사용 추정

| 텍스처 | 소스 크기 | BC 압축 후 |
|--------|--------|----------|
| 2K (2048×2048) RGBA | 16 MB | ~4 MB |
| 1K (1024×1024) RGBA | 4 MB | ~1 MB |
| 512×512 RGBA | 1 MB | ~0.25 MB |

표준 오피스 1층 기준 텍스처 총 VRAM:

```
2K 텍스처 10개: 40 MB
1K 텍스처 20개: 20 MB
512 텍스처 30개: 7.5 MB
아바타 텍스처 10명×2개: 20 MB
────────────────────────
합계: ~87.5 MB (GTX 1650 4GB 대비 여유 있음)
```

---

## 6. 서버 파생 성능 검증 (05 §1.2.13·§3.4 정합)

### 6.1 파생 계산 주체

`performance` 블록의 수치는 **FastAPI 서버가 asset 테이블에서 파생 계산**한다.  
편집기(클라이언트)가 자기신고한 값은 무시하고 서버 계산값으로 덮어쓴다.

```
estimated_polygon_count
  = Σ (furniture[i].asset.polygon_count × instance_count[i])
  (동일 asset_id 반복은 인스턴스 수 그대로 합산)

estimated_draw_calls
  = distinct(asset_id 수) + 외벽·파라메트릭 벽·기타 개별 드로우콜
  (동일 asset_id 그룹 = MultiMesh → 1드로우콜)

estimated_memory_mb
  = Σ (asset.file_size_bytes) / 1024 / 1024 (중복 asset_id는 1회만 계산)
```

### 6.2 성능 검증 임계값

| 항목 | ERROR (배포 불가) | WARNING (배포 가능) |
|------|-----------------|-------------------|
| 드로우콜 | > 200 | 180~200 |
| 폴리곤 | > 1.5M (LOD 0 기준) | 1M~1.5M |
| VRAM (추정) | > 3.5GB | 2.5GB~3.5GB |

> ERROR가 1개라도 있으면 `[무시하고 배포]` 버튼이 없으며 배포 불가(D12).  
> WARNING은 `[경고 무시하고 배포]`로 진행 가능.

---

## 7. Occlusion Culling 전략

### 7.1 동적 씬 제약 (D7)

office_layout JSON으로 씬이 **런타임에 동적 생성**되므로 **에디터에서 전체 씬 Occluder를 사전 베이크할 수 없다**. 방·벽 배치가 배포 때마다 달라지기 때문이다.

### 7.2 런타임 Occluder 부착

두 가지 방식을 병행한다:

**방식 A — 런타임 벽 단위 Occluder**  
`room_builder.gd`가 파라메트릭 벽 세그먼트를 생성할 때 단순 박스 `BoxOccluder3D`를 함께 부착한다.

```gdscript
# wall_segment.gd — 개별 벽 세그먼트에 부착
func _ready() -> void:
    var occ_inst := OccluderInstance3D.new()
    var box := BoxOccluder3D.new()
    box.size = $WallMesh.mesh.get_aabb().size
    occ_inst.occluder = box
    add_child(occ_inst)
```

**방식 B — 고정 외벽 Occluder 동봉**  
배치가 고정된 외벽·기둥은 프리팹(.tscn)에 `OccluderInstance3D`를 미리 포함시킨다.

### 7.3 Frustum Culling

Godot 4의 기본 Frustum Culling이 항상 활성화된다.  
카메라 절두체(FOV 60°) 밖의 노드는 자동으로 렌더링 제외된다.

---

## 8. 자동 LOD (Godot 4 임포트 설정)

### 8.1 임포트 설정

Godot 4 에디터의 `Import` 탭에서 메시별로 다음을 설정한다:

```
Meshes > Generate LODs = true
Meshes > LOD Bias = 1.0    (기본값)
```

자동 LOD 생성이 불충분한 경우 Blender Decimate modifier로 수동 LOD 메시를 제작해 `.tscn`에 포함시킨다.

### 8.2 LOD GDScript 설정 예시

```gdscript
# furniture_desk.gd — LOD 거리 명시적 설정
# @TASK P0-T0.5
# @SPEC docs/planning/07-3d-visual-asset-pipeline.md#6.1
func _ready() -> void:
    $MeshLOD0.visibility_range_begin = 0.0
    $MeshLOD0.visibility_range_end   = 10.0

    $MeshLOD1.visibility_range_begin = 10.0
    $MeshLOD1.visibility_range_end   = 20.0

    $MeshLOD2.visibility_range_begin = 20.0
    $MeshLOD2.visibility_range_end   = 50.0

    $MeshLOD3.visibility_range_begin = 50.0
    $MeshLOD3.visibility_range_end   = 100.0
```

---

## 9. 품질 프리셋 (기준 사양별, D7·D22)

| 프리셋 | 대상 사양 | 목표 FPS | 설정 |
|-------|---------|---------|------|
| **High** (기본) | GTX 1650급 | 60 fps | 직접광 + ReflectionProbe + SSAO. SDFGI OFF. 2K 텍스처. LOD 2까지 |
| **Ultra** (고사양 옵션) | RTX 계열 | 60+ fps | High + SDFGI ON. 모든 LOD. |
| **Medium** | 중형 내장 | 45 fps | LOD 2까지, 1K 텍스처, 파티클 감소 |
| **Low** | Iris Xe 등 내장 | 30 fps | LOD 1만, 512 텍스처, 그림자 축소, SSAO 경량화 |

`lighting_manager.gd`의 `apply_preset()`이 프리셋 전환을 담당한다.

---

## 10. GTX 1650 60fps / 내장 30fps 측정 절차 (S4 스파이크 연계)

### 10.1 측정 환경

- **기준 사양 PC**: GTX 1650, 16GB RAM, Full HD 1920×1080
- **내장 그래픽 PC**: Intel Iris Xe급, 16GB RAM (공유 메모리), Full HD
- **Godot 버전**: 4.x 최신 안정 버전 (Godot 4.x에 별도 LTS 채널 없음)
- **렌더러**: Forward+

### 10.2 측정 시나리오

| 시나리오 | 내용 | 합격 기준 |
|---------|------|--------|
| S1. 빈 씬 | office_layout 로드, 아바타 없음 | GTX1650 > 120fps / 내장 > 60fps |
| S2. 기본 씬 | 아바타 10명 + 가구 50개 + 조명 | GTX1650 ≥ 60fps / 내장 ≥ 30fps |
| S3. 스트레스 씬 | 아바타 20명 + 가구 200개 (설계 100명 중 도그푸딩 20명 기준) | GTX1650 ≥ 60fps / 내장 ≥ 30fps |
| S4. MultiMesh 효과 | 동일 desk 100개 (1드로우콜) | S2 대비 드로우콜 50% 이상 감소 확인 |

### 10.3 측정 방법

```
1. Godot 에디터 > Project > Project Settings > Debug > GDScript Profiler 활성화
2. 씬 실행 (--debug-collisions 옵션 제거 후 측정)
3. Godot 우상단 Debugger > Monitor 탭:
   - FPS (초당 프레임)
   - Memory Used (시스템 메모리)
   - Video Mem Used (VRAM)
   - Draw Calls (드로우콜)
   - Objects Rendered (렌더링 객체 수)
4. 5분 연속 측정, p5 (하위 5%) FPS 값을 기록
5. 합격: p5 FPS ≥ 60 (GTX1650) / ≥ 30 (내장)
```

### 10.4 측정 도구

| 도구 | 용도 |
|------|------|
| Godot Debugger Monitor | FPS·메모리·드로우콜 실시간 |
| GPU-Z (Windows) | VRAM 사용량 독립 측정 |
| MSI Afterburner | GPU 클럭·온도·프레임 오버레이 |

### 10.5 S4 스파이크와의 연계

P0-T0.11(S4 스파이크)에서 골든 샘플 씬으로 이 절차를 실행한다.  
실패 시 폴백: SDFGI 옵션 기본화 + 기준 사양 상향 재협의(00-decisions.md F절 S4).

---

## 11. 메모리 관리 (dispose 패턴)

씬 전환 또는 에셋 제거 시 **메모리 누수 방지**를 위해 dispose 패턴을 적용한다.

```gdscript
# office.gd — 씬 교체 시
func _dispose_current_scene() -> void:
    if _current_floor_node:
        _current_floor_node.queue_free()
        _current_floor_node = null
    # MultiMesh 리소스 해제
    for mm in _active_multimeshes:
        mm.mesh = null
    _active_multimeshes.clear()
```

- `queue_free()`: Godot 프레임 끝에서 안전하게 해제
- `ResourceLoader` 캐시: 동일 `.tscn`은 캐시에서 재사용, 명시적 해제 불필요
- ReflectionProbe: 씬 교체 시 자동 해제 (`queue_free()` 연쇄)

---

## 12. 변경 이력

| 버전 | 일자 | 변경 내용 |
|------|------|----------|
| 1.0 | 2026-07-02 | P0-T0.5 초안 — D7·D22 성능 기준, BC 압축, MultiMesh 집행 규칙, 서버 파생 검증(05 §3.4 정합), GTX1650/내장 측정 절차 |
