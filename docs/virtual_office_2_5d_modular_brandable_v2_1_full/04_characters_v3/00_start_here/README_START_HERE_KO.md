# Virtual Office 2.5D Character Pack v3.0

기존 6명 콘셉트 시트가 아니라 **기존 Registry와 동일한 8명**을 사용합니다.

- JAMES / OLIVIA / ETHAN / SOPHIA / NOAH / AVA / LIAM / MAYA
- 각 캐릭터: IDLE / WALK / SIT / TYPING
- 총 32개 투명 PNG
- 가구는 캐릭터 이미지에 포함하지 않음
- 프레임 시퀀스 대신 단일 프레임 + 코드 모션 사용
- `NOAH_TYPING`, `AVA_SIT`, `AVA_TYPING` 실제 납품 파일의 인물 정체성 확인 완료

## 실행

```bash
python 04_runtime_demo/run_demo.py
```

브라우저: `http://127.0.0.1:8766/04_runtime_demo/`

## 개발 시작 파일

```text
03_registry/character-registry-v3.json
02_shared/character-motion-profiles.json
02_shared/chair-anchor-profiles.json
02_shared/desk-occlusion-rules.json
06_quality/identity-audit.html
```

## 중요

이미지는 오피스 씬의 작은 2.5D 캐릭터 표시를 위한 런타임 자산입니다. 포즈별 원본 캔버스 크기는 다르며, 표시 크기는 Registry의 `display` 값으로 통일합니다.
