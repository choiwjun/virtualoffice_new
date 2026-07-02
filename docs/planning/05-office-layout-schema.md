# 05. office_layout JSON 스키마

**작성일**: 2026-07-01  
**최종 갱신**: 2026-07-02  
**버전**: 1.1  
**담당**: 시스템 설계팀 + 3D 엔진팀  
**참조**: 00-decisions.md (정본 결정, 특히 D7~D12·D25), 04-data-model.md (DB 구조), 06-screens.md (편집기 UI), 07-3d-visual-asset-pipeline.md (에셋 파이프라인)

> 이 문서는 00-decisions.md의 정본 결정을 따른다. 충돌 시 00-decisions.md가 이긴다.

---

## 개요

`office_layout` JSON은 Godot 3D 가상오피스의 **공간 구조 및 상호작용 규칙의 원본(Source of Truth)**이다. 각 층(floor)마다 1개의 JSON blob으로 저장되며(1 floor = 1 layout), 2D 편집기에서 생성/수정되고, 검증 통과 후 Godot 헤드리스 서버와 클라이언트에서 사용된다. 코드로 하드코딩되지 않으므로, 사무실 변경은 DB 업데이트로만 반영된다(재컴파일 불필요).

**핵심 원칙(정본 결정 반영):**
- **공간 구조만 담는다(D10)**: 좌석-직원 배정은 이 JSON에 넣지 않는다. 배정은 DB `seat_assignment` 테이블이 담당하며, 배정 변경은 레이아웃 재배포가 필요 없다.
- **좌표계는 `top_left` 단일·미터 단위(D25)**: 다른 원점은 허용하지 않는다.
- **에셋은 `asset_id` 참조만(D8)**: 클라이언트 빌드(pak)에 동봉된 카탈로그를 조회한다. 런타임에 glb/tscn을 다운로드하지 않는다.
- **정밀 검증은 서버 1곳(D12)**: 도달성(A*) 포함 정밀 검증은 FastAPI가 단독으로 수행한다. 웹 편집기는 경량 체크만, Godot 클라이언트는 검증하지 않고 신뢰한다.

---

## 1. office_layout JSON 스키마 정의

### 1.1 루트 구조

```json
{
  "metadata": { ... },
  "floor": { ... },
  "dimensions": { ... },
  "zones": [ ... ],
  "rooms": [ ... ],
  "seats": [ ... ],
  "furniture": [ ... ],
  "colliders": [ ... ],
  "spawn_points": [ ... ],
  "spawn_default": { ... },
  "minimap": { ... },
  "connections": { ... },
  "performance": { ... }
}
```

### 1.2 각 섹션 정의

#### 1.2.1 metadata

```json
{
  "metadata": {
    "version": "1.0",
    "schema_version": 1,
    "layout_id": "550e8400-e29b-41d4-a716-446655440001",
    "office_id": "550e8400-e29b-41d4-a716-446655440010",
    "floor_id": "550e8400-e29b-41d4-a716-446655440020",
    "floor_name": "3F",
    "created_at": "2026-07-01T10:00:00Z",
    "updated_at": "2026-07-01T15:30:00Z",
    "created_by": 101,
    "updated_by": 102,
    "description": "3층 개발팀 구역 레이아웃 v2",
    "language": "ko-KR"
  }
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| version | string | Y | JSON 스키마 버전(semantic) |
| schema_version | integer | Y | 브레이킹 체인지 감지용 정수 |
| layout_id | UUID | Y | office_layout.id (DB PK) |
| office_id | UUID | Y | office.id |
| floor_id | UUID | Y | floor.id |
| floor_name | string | Y | floor.name (예: "3F", "B1") |
| created_at, updated_at | ISO8601 | Y | 타임스탬프 |
| created_by, updated_by | integer(user_id) | Y | erp_user.id |
| description | string | N | 변경사항 메모 |
| language | string | Y | 로케일 기본값 (현재 ko-KR) |

#### 1.2.2 floor

```json
{
  "floor": {
    "id": "550e8400-e29b-41d4-a716-446655440020",
    "level": 3,
    "name": "3F",
    "total_area_m2": 2500,
    "coordinate_origin": "top_left",
    "floor_height_m": 8.4,
    "grid_snap_unit_cm": 10,
    "unit_system": "metric"
  }
}
```

| 필드 | 설명 |
|------|------|
| id | floor.id (UUID) |
| level | 실제 층수(지상 3층 = 3, B1 = -1) |
| name | 표시명 |
| total_area_m2 | 층 전체 면적(정보용) |
| coordinate_origin | 좌표계 원점. **`top_left` 하나만 허용(D25)**. `center`/`bottom_left`는 폐기 |
| floor_height_m | 이 층 바닥의 Godot 월드 Y 오프셋(m). 다층 매핑에 사용(§5.3) |
| grid_snap_unit_cm | 편집기 그리드 단위(cm) |
| unit_system | 측정 단위. **`metric`(미터) 고정** |

> **D25 좌표계 확정**: 모든 좌표는 원점 `top_left`, 단위 미터, 2D 평면(x, y)로 저장한다. x는 오른쪽(동)으로 증가, y는 아래쪽(남)으로 증가한다. Godot 3D 월드로의 변환식은 §5.3에 정의한다.

#### 1.2.3 dimensions

```json
{
  "dimensions": {
    "width_m": 80.0,
    "height_m": 60.0,
    "min_x": 0.0,
    "max_x": 80.0,
    "min_y": 0.0,
    "max_y": 60.0,
    "unit": "meter"
  }
}
```

층의 전체 바운드박스. 편집기에서 캔버스 크기와 동일.

#### 1.2.4 zones (팀 구역)

```json
{
  "zones": [
    {
      "zone_id": "Z_001",
      "team_zone_db_id": "550e8400-e29b-41d4-a716-446655440030",
      "org_group_id": "550e8400-e29b-41d4-a716-446655440040",
      "erp_team_id": 201,
      "label": "개발팀",
      "type": "team",
      "color": "#4A90E2",
      "polygon": [
        { "x": 0.0, "y": 0.0 },
        { "x": 20.0, "y": 0.0 },
        { "x": 20.0, "y": 15.0 },
        { "x": 0.0, "y": 15.0 }
      ],
      "access_control": {
        "allowed_roles": ["admin", "leader", "employee"],
        "restricted": false
      },
      "visual": {
        "show_boundary": true,
        "boundary_style": "dashed",
        "boundary_width_cm": 2
      }
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| zone_id | string | JSON 내 임시 고유ID(예: Z_001, Z_002) |
| team_zone_db_id | UUID | team_zone.id (DB FK) |
| erp_team_id | BIGINT | ERP teams.id |
| org_group_id | UUID | 우리 org_group.id (상위 부서) |
| label | string | 팀명 |
| type | enum | team, department, meeting_hub 등 |
| color | hex | UI 표시 색상 |
| polygon | array | 좌표 배열(폐쇄형 다각형) |
| access_control | object | 접근권한 정의 |
| visual | object | 경계 표시 옵션 |

#### 1.2.5 rooms (회의실, 라운지, 집중실, 폰부스 등)

```json
{
  "rooms": [
    {
      "room_id": "R_001",
      "room_db_id": "550e8400-e29b-41d4-a716-446655440050",
      "name": "회의실 A",
      "type": "meeting",
      "capacity": 6,
      "floor_id": "550e8400-e29b-41d4-a716-446655440020",
      "coords": {
        "x": 25.0,
        "y": 10.0,
        "width": 6.0,
        "height": 4.5
      },
      "entrance": {
        "trigger_x": 27.25,
        "trigger_y": 13.5,
        "trigger_width": 1.5,
        "trigger_height": 0.8,
        "entry_direction": "south"
      },
      "livekit_room": "meeting_3f_001",
      "capacity_mode": "by_room",
      "max_concurrent_users": 6,
      "doors": [
        {
          "door_id": "D_001",
          "wall": "south",
          "offset": 3.0,
          "width": 1.2,
          "door_type": "glass_single"
        }
      ],
      "glass_walls": [
        {
          "wall_id": "GW_001",
          "edge": "south",
          "start": { "x": 25.0, "y": 14.5 },
          "end": { "x": 31.0, "y": 14.5 },
          "transparency": 0.7,
          "frame_color": "#333333"
        }
      ],
      "climate": {
        "ac_outlet": { "x": 26.0, "y": 11.0 }
      },
      "markers": {
        "whiteboard": { "x": 26.5, "y": 12.0 },
        "projector": { "x": 27.5, "y": 10.5 }
      }
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| room_id | string | JSON 내 임시 고유ID |
| room_db_id | UUID | room.id (DB FK) |
| type | enum | meeting, lobby, lounge, focus, phonebooth |
| capacity | integer | room.capacity (수용 인원) |
| coords | object | 위치(좌상단 x,y) + 크기(width, height) |
| entrance | object | 입장 트리거(콜리전 박스 + 진입 방향). **room 경계 내부**에 위치해야 함(§3.2) |
| livekit_room | string | room.livekit_room(화상회의 연결) |
| capacity_mode | enum | by_seats (좌석 기반) 또는 by_room (방 기반) |
| **doors** | array | **문 개구부(D9)**. 벽 세그먼트에 뚫린 출입구 구멍 정의. 배열이므로 방마다 여러 문 가능 |
| glass_walls | array | 유리벽 정의 |
| markers | object | 화이트보드, 프로젝터 등 랜드마크 |

##### doors (문 개구부) 필드 상세 — D9

room의 벽 콜리전은 room 경계에서 자동 생성되는 벽 세그먼트이며, `doors`에 정의된 위치는 **개구부(구멍)**로 처리되어 아바타가 통과할 수 있다. 개구부가 없으면 방은 사방이 막힌 상자가 되어 진입 불가하다.

| 필드 | 타입 | 설명 |
|------|------|------|
| door_id | string | JSON 내 임시 고유ID |
| wall | enum | 개구부가 뚫릴 벽. `north`/`south`/`east`/`west` (room `coords` 기준 변) |
| offset | float(m) | 해당 벽의 시작 모서리(top_left 기준: west/east 벽은 위쪽 y, north/south 벽은 왼쪽 x)에서 **개구부 중심까지의 거리(m)** |
| width | float(m) | 개구부 폭(m). 도어 폭 규약 0.9~1.2m 권장(07 §1.2와 정합) |
| door_type | enum | 문 스타일(`glass_single`/`glass_double`/`wooden_single`/`wooden_double`/`open`(문짝 없는 개방 통로)) |

> **콜리전 생성 규칙(D9)**: room 경계(coords의 사각형 네 변) → 각 변을 벽 세그먼트로 자동 생성. 단, `doors[]`에 정의된 `(wall, offset, width)` 구간은 벽 세그먼트에서 제외되어 개구부가 된다. 헤드리스 서버는 이 개구부를 A* 내비게이션의 통행 가능 지점으로 사용한다. 별도의 `colliders[]` 항목으로 room 벽을 solid box 하나로 덮지 않는다(그러면 개구부가 사라진다).

#### 1.2.6 seats (고정좌석, 자율좌석, 임시좌석)

> **D10 — 좌석 배정 분리**: seat 객체는 **공간 구조(위치·타입·방향·설비)만** 담는다. 좌석-직원 배정(`assigned_user_id` 등)은 이 JSON에 넣지 않으며, DB `seat_assignment` 테이블이 단독으로 관리한다. 클라이언트/서버는 런타임에 `seat_db_id`로 `seat_assignment`를 조회해 현재 착석자를 얻는다. **좌석 배정 변경은 레이아웃 재배포가 필요 없다**(§2.4 참조).

```json
{
  "seats": [
    {
      "seat_id": "S_001",
      "seat_db_id": "550e8400-e29b-41d4-a716-446655440060",
      "team_zone_id": "550e8400-e29b-41d4-a716-446655440030",
      "seat_type": "fixed",
      "coords": {
        "x": 3.5,
        "y": 2.0
      },
      "facing": 180,
      "furniture_id": "F_001",
      "desk_dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "lifecycle_status": "deployed",
      "accessibility": {
        "wheelchair_accessible": false,
        "ergonomic_type": "standard"
      },
      "nearby_amenities": {
        "has_monitor_stand": true,
        "has_keyboard": true,
        "has_phone": false
      }
    },
    {
      "seat_id": "S_002",
      "seat_db_id": "550e8400-e29b-41d4-a716-446655440061",
      "team_zone_id": "550e8400-e29b-41d4-a716-446655440030",
      "seat_type": "free",
      "coords": {
        "x": 5.0,
        "y": 2.0
      },
      "facing": 180,
      "furniture_id": "F_002",
      "desk_dimension": {
        "width": 1.5,
        "depth": 0.8
      },
      "lifecycle_status": "deployed"
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| seat_id | string | JSON 내 임시 고유ID |
| seat_db_id | UUID | seat.id (DB FK). 착석자 조회는 이 값으로 `seat_assignment` 참조 |
| seat_type | enum | fixed(고정), free(자율), temp(임시), partner(협력사) |
| team_zone_id | UUID | team_zone.id (공간 소속. 직원 배정과 무관) |
| coords | object | 좌석 중심 좌표(x, y) |
| **facing** | float(도) | **착석 방향(D10)**. 아바타가 앉았을 때 바라보는 방향. 도(degree), 시계방향, 기준축 +X(§5.3). 예: 180 = 남향(+Y) |
| **furniture_id** | string | **책상 상호 참조(D10)**. 이 좌석이 딸린 `furniture[]` 항목의 `furniture_id`. 좌석 좌표는 이 가구의 `coords`에서 파생되므로 좌표 중복·desync를 방지한다 |
| desk_dimension | object | 책상 크기(meter). 정보용. 실제 3D 배치는 `furniture_id`가 가리키는 가구 에셋을 따른다 |
| lifecycle_status | enum | deployed, archived, removed |
| accessibility | object | 접근성 정보 |
| nearby_amenities | object | 주변 설비(모니터, 키보드, 전화) |

> **좌석↔가구 좌표 정합**: seat의 `coords`와 `furniture_id`가 가리키는 desk의 `coords`는 동일해야 한다(§3.2 검증 규칙). 편집기는 좌석 배치 시 딸린 desk를 함께 이동시켜 desync를 원천 차단한다.

#### 1.2.7 furniture (테이블, 캐비닛, 베드 등 일반 가구)

> **D8 — 에셋 참조 방식**: furniture는 `asset_id`로 **클라이언트 빌드(pak)에 동봉된 에셋 카탈로그**를 참조한다. layout JSON에 파일 경로(glb 등)를 넣지 않는다. 클라이언트는 `asset_id`로 동봉된 `.tscn`(임포트 완료본)을 `ResourceLoader`로 로드한다(§5.1). 런타임 glb 다운로드/CDN은 사용하지 않는다. `dimension`·`type` 등은 편집기 표시·검증용 캐시이며, 실측 크기 정본은 asset 테이블(07 §5.3)이다.

```json
{
  "furniture": [
    {
      "furniture_id": "F_001",
      "asset_id": "DESK_STANDARD_001",
      "type": "desk",
      "category": "workspace",
      "coords": {
        "x": 10.0,
        "y": 5.0,
        "rotation": 0
      },
      "dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "collision": true,
      "physics": {
        "type": "static",
        "mass": 0
      },
      "visual": {
        "color": "#D4A574",
        "material": "wood"
      },
      "interactive": false
    },
    {
      "furniture_id": "F_002",
      "asset_id": "CABINET_STORAGE_001",
      "type": "cabinet",
      "coords": {
        "x": 15.0,
        "y": 1.0,
        "rotation": 0
      },
      "dimension": {
        "width": 1.2,
        "depth": 0.6,
        "height": 2.0
      },
      "collision": true,
      "physics": {
        "type": "static",
        "mass": 0
      }
    }
  ]
}
```

| 필드 | 설명 |
|------|------|
| furniture_id | JSON 내 고유ID |
| asset_id | asset(에셋 레지스트리).asset_id FK. **클라이언트 동봉 카탈로그 조회 키(D8)** |
| type | desk, cabinet, shelf, plant, sofa, printer 등 |
| coords | 2D 좌표(x, y) + `rotation`(도, 시계방향, 기준축 +X). 3D 배치 변환은 §5.3 |
| dimension | 가구 크기(meter). 표시·검증용 캐시. 정본은 asset 테이블 `dimension` |
| collision | 콜리전 활성화 여부 |
| physics | static(고정), dynamic(움직임), 질량 등 |

#### 1.2.8 colliders (충돌 영역 정의)

> **collider 형상 표기(D12 정합)**: 형상은 `shape` 필드로 `box`/`polygon`을 분리한다. `shape="box"`면 `box` 객체(x, y, width, height, rotation)를, `shape="polygon"`이면 `polygon` 배열(꼭짓점 좌표)을 사용한다. 한 필드(`coords`)가 객체/배열 두 형태를 겸하던 다형성을 제거해 스키마 검증을 단순화한다.

```json
{
  "colliders": [
    {
      "collider_id": "C_001",
      "shape": "box",
      "box": {
        "x": 20.0,
        "y": 10.0,
        "width": 8.0,
        "height": 6.0,
        "rotation": 0
      },
      "physics": {
        "is_kinematic": false,
        "block_avatar": true,
        "block_interaction": false
      },
      "layer": 1,
      "description": "구조 벽(개구부 없는 통짜 벽)"
    },
    {
      "collider_id": "C_002",
      "shape": "polygon",
      "polygon": [
        { "x": 0.0, "y": 0.0 },
        { "x": 15.0, "y": 0.0 },
        { "x": 15.0, "y": 12.0 },
        { "x": 0.0, "y": 12.0 }
      ],
      "physics": {
        "block_avatar": true
      },
      "layer": 1,
      "description": "외부벽"
    }
  ]
}
```

아바타의 움직임 경로(A\* 내비게이션)와 물리 충돌 계산에 사용됨.

> **room 벽과의 관계(D9)**: room 경계 벽은 `doors[]` 개구부를 반영해 **자동 생성**되므로, `colliders[]`에 room을 통짜 box로 다시 넣지 않는다. `colliders[]`는 외벽·기둥·개구부 없는 구조 벽 등 room 스키마로 표현되지 않는 정적 장애물에만 사용한다.

#### 1.2.9 spawn_points (아바타 시작위치)

```json
{
  "spawn_points": [
    {
      "spawn_id": "SP_LOBBY",
      "type": "lobby",
      "coords": { "x": 40.0, "y": 30.0 },
      "facing": 0,
      "description": "로비 입구"
    },
    {
      "spawn_id": "SP_DEV_TEAM",
      "type": "team_zone",
      "zone_id": "Z_001",
      "coords": { "x": 10.0, "y": 8.0 },
      "facing": 45,
      "description": "개발팀 입장"
    }
  ]
}
```

사용자가 층 진입 시 스폰되는 위치. 팀/부서별로 다를 수 있음(권한 기반).

#### 1.2.10 spawn_default

```json
{
  "spawn_default": {
    "spawn_id": "SP_LOBBY",
    "fallback_spawn_id": "SP_LOBBY",
    "facing_default": 0
  }
}
```

기본 스폰 위치. 권한 매칭 실패 시 사용.

#### 1.2.11 minimap

```json
{
  "minimap": {
    "enabled": true,
    "viewport_x": 0.0,
    "viewport_y": 0.0,
    "viewport_width": 80.0,
    "viewport_height": 60.0,
    "pixel_width": 400,
    "pixel_height": 300,
    "pixels_per_meter": 5.0,
    "show_zones": true,
    "show_seats": true,
    "show_rooms": true,
    "show_avatars": true,
    "show_grid": false,
    "layers": [
      {
        "layer_id": "base",
        "type": "background",
        "color": "#F5F5F5"
      },
      {
        "layer_id": "zones",
        "type": "vector",
        "visible": true
      },
      {
        "layer_id": "rooms",
        "type": "vector",
        "visible": true
      }
    ]
  }
}
```

클라이언트의 미니맵 렌더링 설정.

#### 1.2.12 connections (로직 연결)

```json
{
  "connections": {
    "floor_adjacencies": [
      {
        "floor_id": "550e8400-e29b-41d4-a716-446655440019",
        "exit_id": "EXIT_STAIR",
        "entry_id": "SP_STAIR_DOWN",
        "description": "계단"
      },
      {
        "floor_id": "550e8400-e29b-41d4-a716-446655440021",
        "exit_id": "EXIT_ELEVATOR",
        "entry_id": "SP_ELEVATOR",
        "description": "엘리베이터"
      }
    ],
    "exit_points": [
      {
        "exit_id": "EXIT_STAIR",
        "coords": { "x": 75.0, "y": 55.0 },
        "target_floor_id": "550e8400-e29b-41d4-a716-446655440019"
      }
    ],
    "zone_to_room_shortcuts": [
      {
        "zone_id": "Z_001",
        "room_id": "R_001",
        "relation": "primary_meeting_room"
      }
    ]
  }
}
```

층 간 이동, 회의실 바로가기 등 내비게이션 설정.

#### 1.2.13 performance

```json
{
  "performance": {
    "total_furniture_count": 120,
    "total_colliders": 45,
    "total_assets": 32,
    "estimated_polygon_count": 640000,
    "estimated_draw_calls": 180,
    "estimated_memory_mb": 256,
    "recommended_device_tier": "mid",
    "optimization_notes": "동일 asset_id 가구를 MultiMesh로 묶으면 드로우콜 감소 가능"
  }
}
```

클라이언트 성능 예측 및 최적화 힌트.

> **서버 파생 계산(D12 정합)**: `performance` 블록의 수치는 편집기가 자기신고하지 않는다. **FastAPI 서버가 저장 시 asset 테이블(07 §5.3)의 `polygon_count`·`dimension` 등에서 파생 계산**해 채운다. 산정 기준: `estimated_polygon_count`는 각 furniture의 asset `polygon_count` 합(동일 asset_id 반복은 실제 인스턴스 수 그대로 합산), `estimated_draw_calls`는 서로 다른 asset_id 수 + 개별 콜리전 등을 근거로 산정하되 **동일 asset_id 그룹은 MultiMesh 1드로우콜로 계산**(§5.1·07 §6.2). 편집기가 보낸 값은 무시하고 서버 계산값으로 덮어쓴다. 검증 규칙(§3.4)도 이 파생값을 기준으로 판정한다.

---

## 2. 버전 & 상태 관리

### 2.1 status 필드 (office_layout.status)

```
draft      → 작성 중. 검증 미실행. 클라이언트 미배포.
validated  → 검증 완료. 문제 없음. 배포 준비.
deployed   → 라이브 운영 중. 클라이언트 사용 중.
archived   → 이전 버전. 참고용만 유지.
```

### 2.2 버전 관리 규칙

- **schema_version**: 브레이킹 체인지(필드 삭제, 타입 변경)가 있으면 +1. 하위호환성 유지 시 유지.
- **version(metadata.version)**: Semantic Versioning(1.0, 1.1, 2.0). UI에서 변경사항 요약과 함께 저장.
- **롤백 단위**: 버전·롤백은 **층(floor) 단위**다(1 floor = 1 layout). office 전체를 한 번에 롤백하지 않는다(06 §3.3.3과 정합).
- **DB FK 설계**: 
  - seat_db_id, room_db_id 등으로 JSON 내 좌석/방의 현재 구성을 DB와 매칭.
  - 나중에 좌석이 삭제되어도 JSON에서 참조 가능(감사 추적).

#### schema_version 호환성 처리

| 상황 | 동작 |
|------|------|
| **지원 버전 범위** | 클라이언트/서버는 지원하는 `schema_version`의 최소~최대 범위를 상수로 보유(예: `SUPPORTED_SCHEMA = [1, 1]`) |
| **미지원(상위) 버전 수신** | 클라이언트는 **로드를 거부**하고 "클라이언트 업데이트가 필요합니다" 안내 후 자동 업데이트 채널(D8)로 유도. 렌더링을 시도하지 않는다 |
| **미지원(하위) 버전 수신** | 서버가 마이그레이션 어댑터로 최신 스키마로 올려 응답하거나, 어댑터가 없으면 저장 시점에 재검증·업그레이드 |
| **핸드셰이크 협상** | WSS 핸드셰이크의 `protocol_version` 협상(D4)과 함께 `schema_version` 호환성도 확인. 불일치 시 접속 거부 + 안내 |

#### 상태 전이 & 라이브 동기화(롤백 포함)

```
draft → validated → deployed
                       │
                       ├─(롤백)→ rolled_back ─→ (이전 버전) re-deployed
                       └─(신버전 배포)→ 이전 deployed 는 archived
```

- **롤백 시 상태 전이**: 현재 `deployed` 레이아웃을 `rolled_back`으로 표시하고, 지정한 이전 버전을 다시 `deployed`로 승격(re-deployed)한다.
- **라이브 클라이언트 강제 동기화**: 배포/롤백이 확정되면 서버가 접속 중인 모든 클라이언트에 `layout_updated`(layout_id, new_version, schema_version) 이벤트를 push한다. 클라이언트는 안전 시점(회의 중이 아니거나 이동 정지 상태)에 새 레이아웃을 재로드한다. 회의 중 사용자에 대한 처리는 §Open questions 1의 정책을 따른다.

### 2.3 버전 히스토리

```sql
-- office_layouts 테이블
id, office_id, floor_id, version, status, json, created_at, updated_at, created_by, updated_by, changelog

-- 예: changelog (배열 — 변경 이력이 누적되므로 단일 객체가 아닌 배열로 저장)
[
  {
    "changed_by": 102,
    "changed_at": "2026-07-01T15:30:00Z",
    "changes": [
      { "type": "added_seat", "seat_id": "S_101" },
      { "type": "updated_room", "room_id": "R_001", "fields": ["capacity", "name"] }
    ]
  },
  {
    "changed_by": 102,
    "changed_at": "2026-07-02T09:10:00Z",
    "changes": [
      { "type": "added_door", "room_id": "R_001", "door_id": "D_002" }
    ]
  }
]
```

### 2.4 좌석 배정과 레이아웃의 분리 (D10)

좌석-직원 배정은 layout JSON이 아니라 DB `seat_assignment` 테이블(04-data-model.md)에 저장된다.

- layout JSON은 좌석의 **공간 구조**(위치·타입·방향·설비)만 담고 `assigned_user_id`를 갖지 않는다.
- 착석자 조회: `seat_db_id`로 `seat_assignment`(seat_db_id, erp_user_id, assigned_at, released_at) 참조.
- **좌석 배정 변경(직원 자리 이동, 자율좌석 점유/반납 등)은 `seat_assignment`만 갱신**하며 layout 재배포·재검증이 필요 없다. 따라서 배정 변경은 버전을 올리지 않는다(라이브 중 변경으로 인한 inconsistent 위험이 원천 제거됨).
- 공간 구조 변경(좌석 신설/삭제/좌표 이동)만 layout 버전을 올린다.

---

## 3. 검증 규칙 및 검증 아키텍처

### 3.0 검증 아키텍처 (D12)

정밀 검증은 **FastAPI 서버 1곳**에서만 수행한다. 각 계층의 역할:

| 계층 | 검증 범위 | 근거 |
|------|----------|------|
| **웹 편집기(클라이언트)** | **경량 체크만**: JSON 파싱, 좌표 범위, 오브젝트 겹침 등 즉시 피드백용. 이것은 UX 편의이며 권위가 아니다 | D12 |
| **FastAPI 서버(정본)** | **정밀 검증 전부**: 구조·공간·조직/역할·설비·미니맵 + **도달성(A*) 검증**. 공식 JSON Schema 파일 기준 스키마 검증 후, 서버 코드가 도달성·파생 성능값을 계산. ERROR 존재 시 저장 거부 | D12 |
| **Godot 클라이언트** | **검증 안 함**. 서버가 배포한 레이아웃을 신뢰하고 렌더링만 한다 | D12 |

- **공식 JSON Schema 파일 경로**: `backend/app/schemas/office_layout.schema.json`(Draft 2020-12). 서버·편집기·CI가 모두 이 단일 파일을 참조한다. 편집기의 경량 체크도 이 스키마의 부분집합을 사용한다.
- **ERROR/WARNING 정책(D12)**: 하나라도 **ERROR가 있으면 배포 불가**(웹 편집기의 `[무시하고 배포]` 버튼 제거). **WARNING만** `[경고 무시하고 배포]`로 진행 가능. 06 §5.2의 검증 실패 다이얼로그와 정합.
- 아래 §3.1~§3.5의 규칙은 **서버 정밀 검증의 규칙 목록**이다. 심각도(ERROR/WARNING)는 서버 판정 기준이며, 편집기는 이 중 경량 항목만 미리 보여준다.

### 3.1 구조 검증

| 규칙 | 심각도 | 설명 |
|------|--------|------|
| **JSON 파싱** | ERROR | JSON 형식 오류(따옴표, 콤마 등) |
| **필수 필드** | ERROR | metadata, floor, dimensions, zones, rooms, seats, colliders 필수 존재 |
| **ID 고유성** | ERROR | 같은 floor 내 zone_id, room_id, seat_id, furniture_id, collider_id 중복 금지 |
| **좌표 범위** | ERROR | 모든 좌표가 dimensions 내 범위에 있어야 함(x: [min_x, max_x], y: [min_y, max_y]) |

### 3.2 공간 검증

| 규칙 | 심각도 | 설명 |
|------|--------|------|
| **오브젝트 충돌** | ERROR | 가구 또는 방이 콜리전 영역과 겹쳤는가? |
| **좌석 접근성** | WARNING | 좌석이 폐쇄된 공간(콜리전 내부)에 갇혀 있지는 않은가? |
| **회의실 수용인원** | ERROR | `capacity_mode=by_seats`인 room은 **해당 room 경계 내부에 seats가 capacity개** 존재해야 함. `by_room`이면 room 내부 좌석 수와 무관(capacity는 max_concurrent_users로만 판정) |
| **입장 트리거** | ERROR | `entrance.trigger_x, trigger_y`(트리거 박스 전체)가 room `coords` 경계 **내부**에 있어야 함. 경계 밖이거나 콜리전과 겹치면 ERROR |
| **문 개구부 정합(D9)** | ERROR | 각 room의 `doors[]`가 최소 1개 존재(진입 가능). 각 door의 `(wall, offset, width)`가 해당 벽 길이 범위 내에 완전히 들어가야 함(offset±width/2 ⊆ [0, 벽길이]) |
| **입장 트리거↔문 정합** | WARNING | `entrance`가 어느 `doors[]` 개구부와 근접(같은 벽·구간 겹침)하는지. 개구부 없는 벽에 트리거만 있으면 경고 |
| **좌석↔가구 좌표 정합(D10)** | ERROR | seat의 `furniture_id`가 유효한 furniture를 가리키고, seat `coords`와 그 furniture `coords`(x, y)가 일치해야 함(desync 방지) |
| **facing 범위** | WARNING | seat `facing`, spawn `facing`이 [0, 360) 범위(도)인가 |
| **아바타 이동경로** | WARNING | A\* 내비게이션으로 spawn_point → 모든 주요 지점(room entrance/door, zone center) 도달 가능? (**서버 전용 정밀 검증** — D12) |

### 3.3 조직/역할 검증

| 규칙 | 심각도 | 설명 |
|------|--------|------|
| **팀 구역 연결** | ERROR | zone의 erp_team_id가 유효한가?(ERP teams 존재 확인) |
| **org_group 누락** | WARNING | zone이 org_group_id를 지정하지 않으면 경고(권한 계층에 영향) |

> **좌석 배정 검증 제외(D10)**: 좌석-직원 배정은 layout JSON에 없으므로(§2.4) 여기서 검증하지 않는다. 배정 유효성(erp_user 존재 등)은 `seat_assignment` 저장 시점에 별도로 검증한다.

### 3.4 설비 검증

| 규칙 | 심각도 | 설명 |
|------|--------|------|
| **회의실 LiveKit 연결** | WARNING | type=meeting인 room에 livekit_room이 지정되지 않음 |
| **에셋 존재** | ERROR | furniture.asset_id가 클라이언트 동봉 asset 카탈로그(asset 테이블)에 존재하는가?(D8) |
| **드로우콜 예산** | ERROR | 서버 파생 `estimated_draw_calls`(동일 asset_id는 MultiMesh 1콜로 계산)가 예산(07 §1.2 기준 200)을 초과하면 거부 |
| **폴리곤 예산** | WARNING | 서버 파생 `estimated_polygon_count`가 씬 예산(07 §1.2 기준 상한)을 초과하면 경고 |
| **메모리 예측** | WARNING | 서버 파생 `estimated_memory_mb`가 기준 사양(D22: GTX 1650급) VRAM 예산을 초과하면 경고 |

> **개수 프록시 폐기(D7·D12 정합)**: 종전의 "furniture_count > 500개 거부"처럼 **개수를 성능 프록시로 쓰던 규칙은 폐기**한다. 성능 한도는 asset 테이블에서 파생한 **폴리곤/드로우콜 실측 기반값**(§1.2.13)으로 판정한다. 동일 asset_id 반복 배치는 MultiMesh로 묶여 드로우콜에 1회만 계상되므로, 같은 책상 500개가 서로 다른 500개보다 훨씬 저렴하다.

### 3.5 미니맵 검증

| 규칙 | 심각도 | 설명 |
|------|--------|------|
| **뷰포트 범위** | ERROR | minimap.viewport_*이 dimensions를 벗어남 |
| **픽셀 해상도** | WARNING | pixel_width * pixel_height < 100,000 or > 1,000,000 |

### 3.6 검증 실행 흐름

> **아키텍처(D12)**: 편집기는 **경량 체크(범위/겹침)**로 즉시 피드백만 주고, **정밀 검증(도달성 A* 포함)과 최종 심각도 판정은 FastAPI 서버가 단독**으로 한다. 편집기 체크는 권위가 아니므로, 편집기를 통과해도 서버가 ERROR를 낼 수 있다.

```mermaid
sequenceDiagram
  actor Editor as 편집기<br/>(사용자)
  participant Web as 웹 편집기<br/>(경량 체크)
  participant API as FastAPI<br/>(정밀 검증·정본)
  participant ERP as ERP DB<br/>(읽기)
  participant PG as PostgreSQL<br/>우리 DB

  Editor->>Web: 저장 클릭
  Web->>Web: 경량 체크(JSON 파싱, 좌표 범위, 겹침)
  alt 경량 체크 실패
    Web->>Editor: 즉시 피드백(줄 번호/위치)
    Editor->>Web: 수정 후 재시도
  end

  Web->>API: 레이아웃 JSON 제출
  API->>API: 1. JSON Schema 검증(office_layout.schema.json)
  API->>API: 2. 구조·공간 정밀 검증(문 개구부, 좌석↔가구 정합 등)
  API->>ERP: 3. 조직/역할 검증(SELECT teams WHERE id IN ...)
  API->>API: 4. 도달성(A*) 검증 — 서버 전용
  API->>API: 5. 에셋 카탈로그 존재 + 파생 성능값 계산
  alt ERROR 존재
    API->>Web: 검증 실패(ERROR 목록) — 배포 불가
    Web->>Editor: ERROR 표시([무시하고 배포] 없음)
  end

  API->>PG: BEGIN TRANSACTION
  API->>PG: INSERT/UPDATE office_layouts (파생 performance 포함)
  API->>PG: COMMIT
  API->>Web: ✓ 저장 완료(WARNING 있으면 함께)
  Web->>Editor: "저장되었습니다. version 1.1"
```

---

## 4. 예시 JSON: 샘플 층 레이아웃

다음은 실제 가상오피스 3층(개발팀) 로비 및 개발팀 구역의 완전한 예시이다.

```json
{
  "metadata": {
    "version": "1.1",
    "schema_version": 1,
    "layout_id": "550e8400-e29b-41d4-a716-446655440001",
    "office_id": "550e8400-e29b-41d4-a716-446655440010",
    "floor_id": "550e8400-e29b-41d4-a716-446655440020",
    "floor_name": "3F",
    "created_at": "2026-07-01T10:00:00Z",
    "updated_at": "2026-07-02T09:10:00Z",
    "created_by": 101,
    "updated_by": 102,
    "description": "3층 개발팀 구역 레이아웃 v1.1 (문 개구부·좌석 분리 반영)",
    "language": "ko-KR"
  },
  "floor": {
    "id": "550e8400-e29b-41d4-a716-446655440020",
    "level": 3,
    "name": "3F",
    "total_area_m2": 2500,
    "coordinate_origin": "top_left",
    "floor_height_m": 8.4,
    "grid_snap_unit_cm": 10,
    "unit_system": "metric"
  },
  "dimensions": {
    "width_m": 80.0,
    "height_m": 60.0,
    "min_x": 0.0,
    "max_x": 80.0,
    "min_y": 0.0,
    "max_y": 60.0,
    "unit": "meter"
  },
  "zones": [
    {
      "zone_id": "Z_001",
      "team_zone_db_id": "550e8400-e29b-41d4-a716-446655440030",
      "org_group_id": "550e8400-e29b-41d4-a716-446655440040",
      "erp_team_id": 201,
      "label": "개발팀",
      "type": "team",
      "color": "#4A90E2",
      "polygon": [
        { "x": 0.0, "y": 0.0 },
        { "x": 25.0, "y": 0.0 },
        { "x": 25.0, "y": 20.0 },
        { "x": 0.0, "y": 20.0 }
      ],
      "access_control": {
        "allowed_roles": ["admin", "leader", "employee"],
        "restricted": false
      },
      "visual": {
        "show_boundary": true,
        "boundary_style": "dashed",
        "boundary_width_cm": 2
      }
    },
    {
      "zone_id": "Z_002",
      "team_zone_db_id": "550e8400-e29b-41d4-a716-446655440031",
      "org_group_id": "550e8400-e29b-41d4-a716-446655440040",
      "erp_team_id": 202,
      "label": "마케팅팀",
      "type": "team",
      "color": "#E24A8E",
      "polygon": [
        { "x": 25.0, "y": 0.0 },
        { "x": 50.0, "y": 0.0 },
        { "x": 50.0, "y": 20.0 },
        { "x": 25.0, "y": 20.0 }
      ],
      "access_control": {
        "allowed_roles": ["admin", "leader", "employee"],
        "restricted": false
      },
      "visual": {
        "show_boundary": true,
        "boundary_style": "dashed",
        "boundary_width_cm": 2
      }
    }
  ],
  "rooms": [
    {
      "room_id": "R_001",
      "room_db_id": "550e8400-e29b-41d4-a716-446655440050",
      "name": "회의실 A",
      "type": "meeting",
      "capacity": 6,
      "floor_id": "550e8400-e29b-41d4-a716-446655440020",
      "coords": {
        "x": 55.0,
        "y": 5.0,
        "width": 6.0,
        "height": 4.5
      },
      "entrance": {
        "trigger_x": 57.4,
        "trigger_y": 8.5,
        "trigger_width": 1.5,
        "trigger_height": 0.8,
        "entry_direction": "south"
      },
      "livekit_room": "meeting_3f_001",
      "capacity_mode": "by_room",
      "max_concurrent_users": 6,
      "doors": [
        {
          "door_id": "D_R001_S",
          "wall": "south",
          "offset": 3.0,
          "width": 1.2,
          "door_type": "glass_single"
        }
      ],
      "glass_walls": [
        {
          "wall_id": "GW_001",
          "edge": "south",
          "start": { "x": 55.0, "y": 9.5 },
          "end": { "x": 61.0, "y": 9.5 },
          "transparency": 0.7,
          "frame_color": "#333333"
        }
      ],
      "climate": {
        "ac_outlet": { "x": 56.0, "y": 6.0 }
      },
      "markers": {
        "whiteboard": { "x": 56.5, "y": 7.0 },
        "projector": { "x": 57.5, "y": 5.5 }
      }
    },
    {
      "room_id": "R_002",
      "room_db_id": "550e8400-e29b-41d4-a716-446655440051",
      "name": "라운지",
      "type": "lounge",
      "capacity": 15,
      "floor_id": "550e8400-e29b-41d4-a716-446655440020",
      "coords": {
        "x": 65.0,
        "y": 15.0,
        "width": 12.0,
        "height": 8.0
      },
      "entrance": {
        "trigger_x": 68.0,
        "trigger_y": 22.2,
        "trigger_width": 2.0,
        "trigger_height": 0.8,
        "entry_direction": "south"
      },
      "livekit_room": null,
      "capacity_mode": "by_room",
      "max_concurrent_users": 15,
      "doors": [
        {
          "door_id": "D_R002_S",
          "wall": "south",
          "offset": 4.0,
          "width": 2.0,
          "door_type": "open"
        }
      ],
      "glass_walls": [],
      "climate": {
        "ac_outlet": { "x": 70.0, "y": 18.0 }
      },
      "markers": {
        "coffee_machine": { "x": 66.0, "y": 17.0 },
        "snack_table": { "x": 72.0, "y": 19.0 }
      }
    }
  ],
  "seats": [
    {
      "seat_id": "S_001",
      "seat_db_id": "550e8400-e29b-41d4-a716-446655440060",
      "team_zone_id": "550e8400-e29b-41d4-a716-446655440030",
      "seat_type": "fixed",
      "coords": {
        "x": 3.5,
        "y": 2.0
      },
      "facing": 180,
      "furniture_id": "F_001",
      "desk_dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "lifecycle_status": "deployed",
      "accessibility": {
        "wheelchair_accessible": false,
        "ergonomic_type": "standard"
      },
      "nearby_amenities": {
        "has_monitor_stand": true,
        "has_keyboard": true,
        "has_phone": false
      }
    },
    {
      "seat_id": "S_002",
      "seat_db_id": "550e8400-e29b-41d4-a716-446655440061",
      "team_zone_id": "550e8400-e29b-41d4-a716-446655440030",
      "seat_type": "fixed",
      "coords": {
        "x": 5.0,
        "y": 2.0
      },
      "facing": 180,
      "furniture_id": "F_002",
      "desk_dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "lifecycle_status": "deployed",
      "accessibility": {
        "wheelchair_accessible": false,
        "ergonomic_type": "standard"
      },
      "nearby_amenities": {
        "has_monitor_stand": true,
        "has_keyboard": true,
        "has_phone": false
      }
    },
    {
      "seat_id": "S_003",
      "seat_db_id": "550e8400-e29b-41d4-a716-446655440062",
      "team_zone_id": "550e8400-e29b-41d4-a716-446655440030",
      "seat_type": "free",
      "coords": {
        "x": 6.5,
        "y": 2.0
      },
      "facing": 180,
      "furniture_id": "F_003",
      "desk_dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "lifecycle_status": "deployed",
      "accessibility": {
        "wheelchair_accessible": false,
        "ergonomic_type": "standard"
      },
      "nearby_amenities": {
        "has_monitor_stand": true,
        "has_keyboard": true,
        "has_phone": false
      }
    },
    {
      "seat_id": "S_101",
      "seat_db_id": "550e8400-e29b-41d4-a716-446655440063",
      "team_zone_id": "550e8400-e29b-41d4-a716-446655440031",
      "seat_type": "fixed",
      "coords": {
        "x": 28.0,
        "y": 3.0
      },
      "facing": 180,
      "furniture_id": "F_101",
      "desk_dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "lifecycle_status": "deployed",
      "accessibility": {
        "wheelchair_accessible": false,
        "ergonomic_type": "standard"
      },
      "nearby_amenities": {
        "has_monitor_stand": true,
        "has_keyboard": true,
        "has_phone": true
      }
    }
  ],
  "furniture": [
    {
      "furniture_id": "F_001",
      "asset_id": "DESK_STANDARD_001",
      "type": "desk",
      "category": "workspace",
      "coords": {
        "x": 3.5,
        "y": 2.0,
        "rotation": 0
      },
      "dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "collision": true,
      "physics": {
        "type": "static",
        "mass": 0
      },
      "visual": {
        "color": "#D4A574",
        "material": "wood"
      },
      "interactive": false
    },
    {
      "furniture_id": "F_002",
      "asset_id": "DESK_STANDARD_001",
      "type": "desk",
      "category": "workspace",
      "coords": {
        "x": 5.0,
        "y": 2.0,
        "rotation": 0
      },
      "dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "collision": true,
      "physics": {
        "type": "static",
        "mass": 0
      },
      "visual": {
        "color": "#D4A574",
        "material": "wood"
      },
      "interactive": false
    },
    {
      "furniture_id": "F_003",
      "asset_id": "DESK_STANDARD_001",
      "type": "desk",
      "category": "workspace",
      "coords": {
        "x": 6.5,
        "y": 2.0,
        "rotation": 0
      },
      "dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "collision": true,
      "physics": {
        "type": "static",
        "mass": 0
      },
      "visual": {
        "color": "#D4A574",
        "material": "wood"
      },
      "interactive": false
    },
    {
      "furniture_id": "F_101",
      "asset_id": "DESK_STANDARD_001",
      "type": "desk",
      "category": "workspace",
      "coords": {
        "x": 28.0,
        "y": 3.0,
        "rotation": 0
      },
      "dimension": {
        "width": 1.5,
        "depth": 0.8,
        "height": 0.75
      },
      "collision": true,
      "physics": {
        "type": "static",
        "mass": 0
      },
      "visual": {
        "color": "#D4A574",
        "material": "wood"
      },
      "interactive": false
    },
    {
      "furniture_id": "F_CABINET_001",
      "asset_id": "CABINET_STORAGE_001",
      "type": "cabinet",
      "category": "storage",
      "coords": {
        "x": 15.0,
        "y": 1.0,
        "rotation": 0
      },
      "dimension": {
        "width": 1.2,
        "depth": 0.6,
        "height": 2.0
      },
      "collision": true,
      "physics": {
        "type": "static",
        "mass": 0
      },
      "visual": {
        "color": "#CCCCCC",
        "material": "metal"
      },
      "interactive": false
    },
    {
      "furniture_id": "F_SOFA_LOUNGE",
      "asset_id": "SOFA_3SEAT_001",
      "type": "sofa",
      "category": "lounge",
      "coords": {
        "x": 68.0,
        "y": 17.0,
        "rotation": 0
      },
      "dimension": {
        "width": 2.1,
        "depth": 0.9,
        "height": 0.8
      },
      "collision": true,
      "physics": {
        "type": "static",
        "mass": 0
      },
      "visual": {
        "color": "#4A4A4A",
        "material": "fabric"
      },
      "interactive": false
    }
  ],
  "colliders": [
    {
      "collider_id": "C_EXT_WALL_NORTH",
      "shape": "box",
      "box": {
        "x": 0.0,
        "y": 0.0,
        "width": 80.0,
        "height": 0.3,
        "rotation": 0
      },
      "physics": {
        "is_kinematic": false,
        "block_avatar": true,
        "block_interaction": false
      },
      "layer": 1,
      "description": "북쪽 외벽"
    },
    {
      "collider_id": "C_EXT_WALL_SOUTH",
      "shape": "box",
      "box": {
        "x": 0.0,
        "y": 59.7,
        "width": 80.0,
        "height": 0.3,
        "rotation": 0
      },
      "physics": {
        "is_kinematic": false,
        "block_avatar": true,
        "block_interaction": false
      },
      "layer": 1,
      "description": "남쪽 외벽"
    }
  ],
  "spawn_points": [
    {
      "spawn_id": "SP_LOBBY",
      "type": "lobby",
      "coords": { "x": 40.0, "y": 50.0 },
      "facing": 0,
      "description": "층 입장(로비)"
    },
    {
      "spawn_id": "SP_DEV_TEAM",
      "type": "team_zone",
      "zone_id": "Z_001",
      "coords": { "x": 10.0, "y": 8.0 },
      "facing": 45,
      "description": "개발팀 구역 입장"
    },
    {
      "spawn_id": "SP_MARKETING_TEAM",
      "type": "team_zone",
      "zone_id": "Z_002",
      "coords": { "x": 35.0, "y": 8.0 },
      "facing": 45,
      "description": "마케팅팀 구역 입장"
    }
  ],
  "spawn_default": {
    "spawn_id": "SP_LOBBY",
    "fallback_spawn_id": "SP_LOBBY",
    "facing_default": 0
  },
  "minimap": {
    "enabled": true,
    "viewport_x": 0.0,
    "viewport_y": 0.0,
    "viewport_width": 80.0,
    "viewport_height": 60.0,
    "pixel_width": 400,
    "pixel_height": 300,
    "pixels_per_meter": 5.0,
    "show_zones": true,
    "show_seats": true,
    "show_rooms": true,
    "show_avatars": true,
    "show_grid": false,
    "layers": [
      {
        "layer_id": "base",
        "type": "background",
        "color": "#F5F5F5"
      },
      {
        "layer_id": "zones",
        "type": "vector",
        "visible": true
      },
      {
        "layer_id": "rooms",
        "type": "vector",
        "visible": true
      },
      {
        "layer_id": "seats",
        "type": "vector",
        "visible": true
      },
      {
        "layer_id": "avatars",
        "type": "raster",
        "visible": true
      }
    ]
  },
  "connections": {
    "floor_adjacencies": [
      {
        "floor_id": 2,
        "exit_id": "EXIT_STAIR",
        "entry_id": "SP_STAIR_DOWN",
        "description": "계단(2층으로)"
      },
      {
        "floor_id": 4,
        "exit_id": "EXIT_ELEVATOR",
        "entry_id": "SP_ELEVATOR",
        "description": "엘리베이터(4층으로)"
      }
    ],
    "exit_points": [
      {
        "exit_id": "EXIT_STAIR",
        "coords": { "x": 75.0, "y": 55.0 },
        "target_floor_id": 2
      },
      {
        "exit_id": "EXIT_ELEVATOR",
        "coords": { "x": 78.0, "y": 28.0 },
        "target_floor_id": 4
      }
    ],
    "zone_to_room_shortcuts": [
      {
        "zone_id": "Z_001",
        "room_id": "R_001",
        "relation": "primary_meeting_room"
      }
    ]
  },
  "performance": {
    "total_furniture_count": 6,
    "total_colliders": 2,
    "total_assets": 3,
    "estimated_polygon_count": 118000,
    "estimated_draw_calls": 9,
    "estimated_memory_mb": 96,
    "recommended_device_tier": "low",
    "optimization_notes": "소규모 샘플. desk 4개는 동일 asset_id(DESK_STANDARD_001)이므로 MultiMesh 1드로우콜로 계상됨."
  }
}
```

> 위 `performance` 값은 서버가 asset 카탈로그에서 파생 계산한 예시다(§1.2.13). desk 4개(F_001·F_002·F_003·F_101)는 같은 `asset_id`라 드로우콜 1회로 묶인다. 편집기가 보낸 값이 아니라 서버 계산값이 정본이다.

---

## 5. 클라이언트/서버 로드 및 사용

### 5.1 Godot 클라이언트

에셋은 **`asset_id`로 클라이언트 빌드(pak)에 동봉된 `.tscn`을 로드**한다(D8). 런타임 glb 다운로드는 없다. 동일 `asset_id` 그룹은 **MultiMesh 1드로우콜로 병합**한다(D7 드로우콜 예산·07 §6.2 연계). 좌표 변환은 §5.3의 `layout_to_world()`를 사용한다.

```gdscript
# 로드
var layout_json: String = # API에서 fetch (배포된 layout)
var layout: Dictionary = JSON.parse_string(layout_json)

# asset_id → 클라이언트 동봉 .tscn 경로(카탈로그). pak에 포함되어 있음.
const ASSET_CATALOG := {
  "DESK_STANDARD_001": "res://assets/3d/models/desk_standard/desk_standard.tscn",
  "CABINET_STORAGE_001": "res://assets/3d/models/cabinet_storage/cabinet_storage.tscn",
  "SOFA_3SEAT_001": "res://assets/3d/models/sofa_3seat/sofa_3seat.tscn",
}

func build_scene(layout: Dictionary) -> Node3D:
  var scene = Node3D.new()
  var floor_h: float = layout["floor"]["floor_height_m"]

  # 가구: 동일 asset_id 끼리 그룹핑 → MultiMesh (드로우콜 예산 준수)
  var groups := {}   # asset_id -> [furniture, ...]
  for furniture in layout["furniture"]:
    groups.get_or_add(furniture["asset_id"], []).append(furniture)

  for asset_id in groups:
    var tscn_path: String = ASSET_CATALOG[asset_id]   # 카탈로그 미존재 시 검증에서 이미 걸러짐
    var packed := ResourceLoader.load(tscn_path) as PackedScene
    var items: Array = groups[asset_id]
    if items.size() >= 2:
      _add_multimesh(scene, packed, items, floor_h)    # 동일 에셋 다중 → 1드로우콜
    else:
      var inst := packed.instantiate()
      inst.transform = layout_to_world(items[0]["coords"], floor_h)
      scene.add_child(inst)

  # room 벽: 경계에서 자동 생성하되 doors[] 개구부는 구멍으로 (D9)
  for room in layout["rooms"]:
    _build_room_walls(scene, room, floor_h)   # doors 반영, solid box로 덮지 않음

  # 정적 콜리전(외벽·기둥 등): shape 필드로 box/polygon 분기
  for collider in layout["colliders"]:
    _add_static_collider(scene, collider, floor_h)

  build_minimap(layout["minimap"])
  return scene
```

### 5.2 Godot 헤드리스 서버

```gdscript
# A* 내비게이션 생성(colliders 기반)
var astar = AStar2D.new()
for collider in layout["colliders"]:
  # 네비메시 생성
  pass

# 근접(proximity) 감지(zones 기반)
func check_proximity(user_pos: Vector2) -> String:
  for zone in layout["zones"]:
    if Geometry2D.point_in_polygon(user_pos, zone["polygon"]):
      return zone["zone_id"]
  return ""

# 회의실 점유(rooms 기반)
func enter_room(user_id: int, room_id: String) -> bool:
  var room = find_room(room_id)
  if room["current_occupants"].size() < room["max_concurrent_users"]:
    room["current_occupants"].append(user_id)
    return true
  return false
```

### 5.3 좌표계 → Godot 월드 매핑 (D25)

layout JSON의 2D 좌표(원점 `top_left`, 미터)를 Godot 3D 월드로 변환하는 **단일 규약**이다.

**변환식:**

```
Vector3(x, floor_height, y)
```

- **x(월드 X)** = layout `coords.x`. **+X = 동쪽**.
- **floor_height(월드 Y)** = `floor.floor_height_m`. 높이축은 층 바닥 오프셋으로만 쓰고, 개별 오브젝트의 z(높이)는 에셋 `.tscn` 자체가 결정한다.
- **y축 매핑(월드 Z)** = layout `coords.y`. **+Z = 남쪽**. (top_left 원점에서 y가 아래로 증가하므로 남쪽이 +Z)

**회전·facing 규약:**
- 단위 **도(degree)**, **시계방향**, **기준축 +X**(동쪽이 0도).
- 따라서 0=동(+X), 90=남(+Z), 180=서(-X), 270=북(-Z).
- Godot의 `rotate_y`는 반시계·라디안 기준이므로 부호 변환이 필요: `basis = Basis(Vector3.UP, deg_to_rad(-angle_cw))`.

```gdscript
# 단일 오브젝트 변환(furniture.coords, seat.facing, spawn.facing 공통)
func layout_to_world(coords: Dictionary, floor_height: float) -> Transform3D:
    var pos := Vector3(coords["x"], floor_height, coords["y"])   # +X 동, +Z 남
    var angle_cw: float = float(coords.get("rotation", 0.0))     # 도, 시계방향, 기준축 +X
    var basis := Basis(Vector3.UP, deg_to_rad(-angle_cw))
    return Transform3D(basis, pos)
```

**다층 건물의 floor_height 오프셋:**
- 각 층 JSON의 `floor.floor_height_m`가 그 층 바닥의 월드 Y다.
- 규칙: `floor_height_m = (level - 1) * story_height` (지상). 예: 층고 `story_height = 4.2m`면 1F=0.0, 2F=4.2, 3F=8.4. 지하는 음수(B1 level=-1 → -4.2).
- 다층을 동시에 로드할 때는 각 층 씬을 해당 `floor_height_m`만큼 Y로 올려 배치한다. 층 전환(계단/엘리베이터, `connections`)은 대상 층의 spawn으로 텔레포트한다.

> 종전 "z는 Godot에서 자동 계산(가정)" 문구는 이 규칙으로 대체된다. 높이축(월드 Y)은 층 오프셋(`floor_height_m`) + 에셋 자체 높이로 결정되며, layout 좌표의 y는 **월드 Z(남북)**에 매핑된다.

---

## 6. Loop Metadata

### Upstream documents referenced
- 04-data-model.md: erp_user, team_zone, office, floor, room, seat, presence, meeting, kpi_result, asset 테이블 스키마
- 10-roadmap.md: 7단계 로드맵(특히 Step 3. 사무실 배치 편집기)

### Downstream documents affected
- 06-screens.md: JSON 편집기 UI 설계(좌표 선택, 검증 결과 표시)
- 07-3d-visual-asset-pipeline.md: Godot 클라이언트 씬 빌드(office_layout 파싱, 렌더링)
- 02-trd-architecture.md: office_layout CRUD 엔드포인트, 검증 API 정의

### Open questions
1. **공간 구조 변경 시 라이브 처리**: deployed 상태에서 좌석 좌표/문 위치 등 **공간 구조**가 바뀌어 재배포되면, 회의 중인 사용자는 재로드 시점을 언제로? → §2.2 라이브 강제 동기화 정책(안전 시점 재로드) 기준. (배정 변경은 D10으로 재배포 자체가 없어 해당 없음)
2. **폴리곤 좌표 정확도**: 16자리 소수점 필요? 정수(cm 단위) 충분?
3. **에셋 버전 관리**: 클라이언트 동봉 asset(.tscn)이 업데이트되면 기존 layout에서 자동 로드되나? → D8: 신규/갱신 에셋은 클라이언트 자동 업데이트 채널로 배포. asset_id는 유지, 내용만 갱신되므로 layout 수정 불필요. 브레이킹 변경 시 새 asset_id 부여 + layout 마이그레이션.
4. **다층 빌딩의 floor_id**: 각 office_layout은 1개 floor_id만 가지는가? 또는 1개 JSON이 여러 층을 포함할 수 있나? → 현재 설계: 1 floor = 1 layout (확정). 다층 동시 로드는 §5.3 floor_height 오프셋으로 처리.

### Assumptions
- 좌표계는 2D(x, y)만 저장(원점 top_left, 미터). 월드 Y(높이축)는 `floor_height_m` 오프셋 + 에셋 자체 높이로 결정되고, layout의 y는 월드 Z(남북)에 매핑된다(§5.3, D25).
- 좌석은 room 내부(by_seats 모드일 때 capacity만큼) 또는 개방 구역/by_room에 속함.
- 에셋 카탈로그(asset 테이블)는 클라이언트 빌드에 동봉되며, JSON에서는 asset_id로만 참조(D8).
- 좌석-직원 배정은 layout이 아니라 `seat_assignment` DB가 담당(D10). ERP DB 동기화(teams, users)는 별도 배치 작업.

### Validation criteria
- [x] 모든 필드 설명: 타입, 필수 여부, 용도
- [x] 예시 JSON: 실제 사용 가능 (Godot 로드, 검증 통과) — v1.1에서 자체 검증 위반(입장 트리거 경계·by_seats 좌석 0개·문 개구부) 수정 완료
- [x] 검증 규칙: 에러/경고 분류, 심각도별 처리 흐름, 검증 아키텍처(D12)
- [x] 버전 관리: schema_version 호환성 처리, status·롤백 상태 전이, changelog(배열)
- [x] mermaid 다이어그램: 검증 시퀀스(웹 경량/서버 정밀 분리)
- [x] 상호 참조: 00(정본), 04, 06, 07 등 다른 문서 명확히 표기

### Risks
- **성능**: 파생 폴리곤/드로우콜 예산 초과 시 A*·렌더링 성능 저하. 개수가 아니라 파생값으로 모니터링(§3.4).
- **권한 누락**: 좌석/구역에 org_group_id가 없으면 접근 제어 실패. 검증 경고 필수.
- **문 개구부 누락**: room에 doors[]가 없으면 진입 불가한 밀폐 상자가 됨. 검증 ERROR로 차단(§3.2).
- **에셋 카탈로그 불일치**: 클라이언트 pak의 asset 카탈로그와 layout asset_id가 어긋나면 로드 실패. 검증에서 존재 확인 + 클라이언트 자동 업데이트 채널로 동기화(D8).

---

## 7. 변경 이력

| 버전 | 일자 | 변경 내용 |
|------|------|----------|
| 1.0 | 2026-07-01 | 초안 |
| 1.1 | 2026-07-02 | 00-decisions 반영: D9 문 개구부(doors[]) 신설·room 벽 자동생성 규칙, D10 좌석 배정 분리(assigned_user 제거·facing·furniture_id·§2.4), D25 좌표계 top_left 단일화·Godot 매핑식·floor_height 오프셋(§5.3), D12 검증 아키텍처(서버 단일 정밀검증·공식 JSON Schema·ERROR 배포차단)·검증 흐름 재작성, D8 에셋 asset_id 카탈로그 참조·model_glb 제거·씬빌더 ResourceLoader+MultiMesh, D7 드로우콜 예산 파생값 기준, schema_version 호환성·롤백 상태전이 보강, collider shape 필드 분리, floor_id UUID 통일, performance 서버 파생 계산, 샘플 JSON 자체 검증 위반 수정, "설파" 오탈자 수정, changelog 배열화 |

---

**작성자**: 시스템 설계팀  
**마지막 수정**: 2026-07-02  
**검토 상태**: 개정(v1.1, 정본 결정 반영)
