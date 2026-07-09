# 포토리얼 웹 렌더 전략 (정본)

> 2026-07-05 확정 · 2026-07-08 복원/정리. 유실됐던 정본을 재작성.
> 가상오피스 3D 뷰를 **Godot 실시간 웹에서 웹 오프라인렌더 하이브리드로 전환**한 확정 전략.
> 관련: [design-style-analysis.md](./design-style-analysis.md)(비주얼 톤), 14-virtual-office-spec(기능).

---

## 0. 왜 전환했나 (Godot 폐기 사유)

- **Godot 실시간 웹**(Compatibility 렌더러)으로 시안급 포토리얼 시도 → **품질 시안 대비 ~40%**, 용량 무거움.
- 실시간 GI/스플랫은 **고정 아이소 뷰에 오버킬**. 결론: "라이트를 실시간 계산하지 말고 **오프라인으로 구워라**".
- 포토리얼 협업앱 오픈소스 선례 없음(전부 2D/카툰: WorkAdventure·Gather 등) → **뼈대와 렌더를 분리 조달**하는 하이브리드가 유일 경로.

---

## 1. 확정 스택

| 계층 | 선택 | 라이선스 | 비고 |
|---|---|---|---|
| **앱 뼈대(네트워킹)** | **SkyOffice** 이식 | MIT | Colyseus(권위 서버) + PeerJS. >4명 시 mediasoup 검토. **Phaser는 버림**(렌더만 교체) |
| **렌더** | **react-three-fiber (R3F)** | MIT | three.js 기반, Next.js 임베드 |
| **환경(배경)** | **Blender Cycles 오프라인 렌더** + **Z(깊이) 패스** | - | 정적 포토리얼 배경 이미지 + 깊이맵 |
| **합성** | R3F 실시간 아바타 ↔ 배경 **깊이합성**(자동 가림) | - | 아바타가 가구/유리벽 뒤로 정확히 가려짐 |
| **후처리** | pmndrs/postprocessing | MIT | ACES/AgX 톤매핑 · N8AO · Bloom · SMAA |
| **에셋** | CC0 ~90% (Poly Haven · ambientCG · Chocofur) | CC0 | 유일 유료갭 = **사람 아바타**(MakeHuman 무료 / CC4 유료). **Ready Player Me 금지**(2026-01 종료) |

---

## 2. 핵심 아이디어: "구운 배경 + 실시간 아바타 깊이합성"

```
[Blender Cycles]  직교(ortho) 아이소 카메라로 오피스 씬 렌더
      │
      ├─ Color 패스  → office_bg.png   (포토리얼 배경)
      └─ Depth 패스  → office_depth.png (픽셀별 깊이)
                           │
[R3F 웹]  같은 직교 카메라 행렬 재현
      │
      ├─ 배경 = office_bg를 풀스크린 쿼드로
      ├─ 아바타 = 실시간 3D(GLTF), 같은 좌표계
      └─ 깊이합성: 아바타 프래그먼트 깊이 vs office_depth 비교
                   → 배경보다 뒤면 discard(가림) → 자연스러운 오클루전
```

- **office_depth 규약**: 0=near(black) ‥ 1=far(white), **16bit** (camera.json `depth_encoding`, 스파이크 실측 — spikes/depth-composite).
- **결과 품질**: 배경은 **렌더 이미지 자체**라 시안과 거의 동일(~90%+).
- **트레이드오프**: 카메라가 **고정 아이소 시점**(자유 회전 불가). 시안이 고정 아이소라 목표와 일치 → **2.5D 포토리얼**.
- **레이아웃 변경**: 층/배치가 바뀌면 해당 씬 **재렌더** 필요(즉시 반영 아님) → 렌더 파이프라인 배치화.

---

## 3. 미검증 리스크 = Phase 0 스파이크 (착수 전 필수)

> **이 스파이크 성공이 전체 전략의 전제.** 실패 시 전략 재검토.

**목표**: Blender 직교카메라 행렬을 export → R3F에서 동일 카메라 재현 → 깊이합성으로 아바타가 책상/유리벽 뒤에 **픽셀 단위로 정확히 가려지는가** 검증.

**산출물**:
- `render-pipeline/build_office.py` (Blender 헤드리스 렌더 + 카메라행렬/깊이 export) — **※ 2026-07-05 세션에서 실행했으나 git 미커밋으로 유실. 재작성 필요.**
- R3F 최소 씬: 배경 쿼드 + 테스트 아바타 1개 + 깊이합성 셰이더.
- 검증: 아바타를 책상 앞/뒤로 이동 → 가림 경계가 정확한지 스크린샷 비교.

**소요**: 며칠. 성공하면 나머지는 "난이도"가 아니라 "실행량".

---

## 4. 파이프라인 (배경 생성 → 웹 서빙)

```
office_layout JSON (좌석/벽/회의실/구역)
   → [Blender] 파라메트릭 씬 빌드(build_office.py) + CC0 에셋 배치
   → Cycles 렌더(color + depth + 필요시 노멀/AO 패스)
   → 후처리(톤매핑) → office_bg.png / office_depth.png / camera.json
   → 정적 에셋 서빙(map-storage 유사) → R3F가 로드
```

- 층별/레이아웃 버전별로 렌더 산출물 캐싱. 편집기에서 배치 확정 → 배치 렌더 트리거.
- 아바타(사람)는 실시간 GLTF(경량), 씬 조명에 맞춘 IBL/라이트 프로브로 정합.

---

## 5. 좌표계 정합 (Web ↔ Blender ↔ 서버)

- **단일 좌표 원점**: office_layout의 top_left 미터 좌표계(05-office-layout-schema 정본).
- Blender 씬·R3F 씬·이동서버(SkyOffice) 모두 동일 미터 좌표 사용 → 아바타 위치가 배경과 정합.
- 직교 카메라 행렬(ortho scale·회전·위치)을 camera.json으로 공유 → 웹이 그대로 재현.

---

## 6. 남은 실행 항목(스파이크 이후)

1. 아바타 에셋·리깅·애니메이션(idle/walk) + 씬 조명 정합(최난제, 목표 80~90%).
2. Blender 파라메트릭 빌더(layout JSON → 씬) 자동화.
3. SkyOffice 네트워킹 이식(Colyseus 권위 서버, 20Hz).
4. R3F 뷰포트 컴포넌트 + 대시보드 셸 통합(design-style-analysis 기준).

---

## 7. 한 줄 요약

**실시간 렌더로는 못 넘는 포토리얼을, "오프라인으로 구운 배경 + 실시간 아바타 깊이합성"으로 넘는다. 대가는 고정 아이소 시점(2.5D). 성패는 깊이합성 스파이크 하나에 달렸다.**
