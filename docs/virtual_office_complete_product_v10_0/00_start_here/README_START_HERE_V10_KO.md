# Virtual Office Complete Product v10.0

이 패키지는 v9의 전체 오피스 에셋에 다음을 실제 파일로 추가한 통합 개발 제품입니다.

- 모든 모델/씬의 PBR 강화본: UV0, 노멀, BaseColor, Normal, Metallic-Roughness가 GLB 내부에 포함
- 리깅·스킨 캐릭터 8종과 캐릭터별 내장 애니메이션 12종
- 개별 에셋 자유 배치용 레지스트리 및 3개 레이아웃 프리셋
- 캐릭터 바닥 클릭 이동, A* 경로 탐색, 충돌 회피
- 좌석/업무 앵커 기반 앉기·타이핑
- 이동·회전·복제·삭제·저장·불러오기 가능한 Three.js 레이아웃 편집기
- Three.js, Unity, Godot 연동 코드

## 가장 빠른 실행

```bash
python run_virtual_office_v10.py
```

그다음 `http://localhost:8765`을 엽니다.

## 개발에서 우선 사용할 경로

```text
01_runtime_3d/models_pbr_v10/       개별 PBR 내장 모델
01_runtime_3d/scenes_pbr_v10/       PBR 내장 완성 씬
05_registries/asset-registry-v10.json
12_layout_presets/
11_complete_runtime_app/
```

## 중요한 품질 범위

이번 v10은 실제 로딩·배치·리깅·애니메이션·PBR·이동·편집 기능을 갖춘 완성형 실시간 개발 패키지입니다. 다만 모델 형상은 실시간 최적화된 스타일라이즈드/절차형 기반이며, 첨부한 콘셉트 이미지와 동일한 수작업 포토리얼 조형 품질을 의미하지는 않습니다. 콘셉트와 동일한 근접 촬영용 품질에는 전문 3D 아티스트의 수작업 리토폴로지, 디테일 스컬프팅, 아트 디렉션 검수가 추가로 필요합니다.
