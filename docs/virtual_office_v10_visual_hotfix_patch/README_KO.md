# Virtual Office v10 Visual & NPC Animation Hotfix

현재 v10 런타임의 과노출, 과도한 Bloom, 강한 반사, 유리 정렬 문제와 배치된 NPC가 바인드/T 포즈로 남는 문제를 줄이는 응급 패치입니다.

## 적용

기존 프로젝트에서 아래 파일을 교체합니다.

- `11_complete_runtime_app/src/runtime/OfficeApp.ts`
- `11_complete_runtime_app/src/runtime/AssetStore.ts`
- `11_complete_runtime_app/src/runtime/LayoutEditor.ts`

그 뒤 빌드합니다.

```bash
cd 11_complete_runtime_app
npm ci
npm run build
```

또는 프로젝트 루트에서 패치를 적용합니다.

```bash
git apply visual-hotfix-v10.patch
```

`11_complete_runtime_app/dist/`에는 이 패치로 빌드 검증한 결과가 포함되어 있습니다.

## 변경 사항

- ACES 노출 `1.08 → 0.72`
- 주광 `4.2 → 1.65`
- Hemisphere light `1.2 → 0.42`
- Fill light `1.1 → 0.28`
- 전역 Bloom `0.45 → 0.10`
- 환경 반사 강도 감소
- Warm/Blue emissive 강도 제한
- 피부·대리석·콘크리트·플라스틱·가죽 임시 재질 보정
- 유리 transmission/depthWrite 보정
- 카메라를 더 높은 전체 오피스 구도로 조정
- 에디터 그리드 기본 숨김
- `AssetStore`가 GLB 애니메이션을 보존하도록 수정
- `LayoutEditor`에서 배치한 리깅 캐릭터에 AnimationMixer 생성
- 모든 NPC에 `ANIM_IDLE_001` 자동 재생 및 매 프레임 mixer 업데이트

## 한계

이 패치는 현재 GLB를 덜 날아가고 덜 플라스틱처럼 보이게 하며 NPC T 포즈를 줄이는 응급 조치입니다. 캐릭터와 가구의 메시 형상 자체가 목표 시안보다 단순하므로, 목표 시안 수준을 만들려면 동일한 `asset_id`, pivot, anchor를 유지한 채 고품질 GLB로 교체해야 합니다.
