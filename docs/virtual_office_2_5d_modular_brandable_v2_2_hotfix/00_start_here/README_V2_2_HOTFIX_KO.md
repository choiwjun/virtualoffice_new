# Virtual Office 2.5D v2.2 Functional Hotfix

이번 빌드는 v2.1 기술 감사에서 확인된 실행 차단 문제를 수정한 통합본입니다.

## 수정 완료

- `module-catalog.json`: 빈 배열 제거, 실제 파일 54개 등록
- `03_modules/`: 공간·가구 18개와 소품 36개 포함
- 메인 `setupActor()`: 죽은 스텁 제거, 8명 Registry 연동
- 메인 씬 캐릭터: IDLE/WALK/SIT/TYPING 상태 전환 및 클릭 이동
- `run_demo.py`: 서버 루트 수정 및 `/` 리다이렉트로 404 제거
- `run_character_demo.py`: 서버 루트 수정
- `MODULAR_SANDBOX`: 7개 기본 모듈이 즉시 보이는 샘플 레이아웃 추가
- `asset-registry-v2.json`: 모듈·소품·캐릭터 상태를 실제 파일로 등록
- `self_test.py`: 경로·개수·죽은 스텁 자동 검사

## 실행

```bash
python run_demo.py
```

또는 먼저:

```bash
python self_test.py
```

## 캐릭터 아트 범위

이번 v2.2는 실행 차단 버그와 데이터 누락을 해결한 **기능 핫픽스**입니다. 기존 32개 캐릭터 PNG를 새 부감 원화로 재렌더링한 빌드는 아닙니다. 캐릭터는 작게 표시되는 데모용으로 연결했으며, 새로운 부감 원화 제작은 별도 아트 교체 작업입니다.
