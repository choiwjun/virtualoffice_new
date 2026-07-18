

## 문서 구조

```
docs/
├── skills/                    # 스킬별 상세 문서
│   ├── deep-research.md
│   ├── socrates.md
│   ├── screen-spec.md         # NEW!
│   ├── tasks-generator.md
│   ├── design-linker.md
│   ├── project-bootstrap.md
│   └── chrome-browser.md
│
└── planning/                  # /socrates가 생성하는 문서
    ├── 01-prd.md              # 제품 요구사항
    ├── 02-trd.md              # 기술 요구사항
    ├── 03-user-flow.md        # 사용자 흐름
    ├── 04-database-design.md  # DB 설계
    ├── 05-design-system.md    # 디자인 시스템
    ├── 06-screens.md          # 화면 목록 ← NEW!
    ├── 06-tasks.md            # 개발 로드맵 (/tasks-generator)
    └── 07-coding-convention.md # 코딩 컨벤션

specs/                         # /screen-spec이 생성 ← NEW!
├── domain/
│   └── resources.yaml         # 도메인 리소스
└── screens/
    └── *.yaml                 # 화면별 명세
```

---

## 참고 자료

- [WORKFLOW.md](WORKFLOW.md) - 전체 워크플로우 가이드
- [INSTALL.md](INSTALL.md) - 설치 상세 가이드
- [CHANGELOG.md](CHANGELOG.md) - 변경 이력

---

## 라이선스

MIT License
