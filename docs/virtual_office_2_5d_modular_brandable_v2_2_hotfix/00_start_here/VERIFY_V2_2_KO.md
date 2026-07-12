# v2.2 검증 체크리스트

다음 명령으로 실행 전 파일 검사를 수행합니다.

```bash
python self_test.py
```

정상 출력:

```text
PASS: 54 modules, 8 characters, runtime actor enabled
```

실행:

```bash
python run_demo.py
```

브라우저 주소:

```text
http://127.0.0.1:8765/07_runtime/index.html
```

확인 항목:

- 메인 ACME 씬에 Olivia 캐릭터가 표시됨
- 바닥 클릭 시 Walk → 이동 → Idle 복귀
- 캐릭터 선택 목록에 8명 표시
- 상태 선택에 Idle / Walk / Sit / Typing 표시
- Modular Sandbox 전환 시 카탈로그와 기본 모듈 7개 표시
- 카탈로그 에셋 클릭 시 모듈 추가
- 드래그 이동 및 더블클릭 삭제
- JSON 저장
