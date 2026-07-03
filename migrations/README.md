# `migrations/` — ERP dev 브랜치용 Alembic (별개 트리)

> ⚠️ **이 트리는 우리 백엔드 스키마가 아니다.** 우리 플랫폼 DB 스키마는 전부
> `backend/alembic/` 에서 관리한다(정본: `backend/app/models/tables.py`, 테이블 `kpi_result` **단수**).

## 무엇인가

이 디렉터리는 **ERP(DailyLog) 저장소의 `feature/virtual-office-integration` 브랜치**에
적용할 마이그레이션을 담는다. ERP 측이 우리 플랫폼의 확정 KPI push(D15/D17)를 수신하려면
ERP 스키마에 **`kpi_results` 스칼라 테이블(복수)** 이 신설되어야 한다(ERP엔 KPI 저장소 부재).

- `alembic/versions/0001_kpi_results_table.py` — ERP `kpi_results` 테이블 생성.
  - 스칼라 롱포맷: `metric` VARCHAR + `value` FLOAT (D16), UNIQUE `(company_id, user_id, period_type, period_key, metric)`.
  - 정본 참조: `docs/erp-integration/contract.md` §2.2·§5.1, `docs/planning/00-decisions.md` D15·D16·D17, `docs/planning/04-data-model.md` §2.5.

## 왜 여기 별도로 두는가

- ERP `kpi_results`(복수, ERP 수신 스칼라 테이블)와 우리 `kpi_result`(단수, 플랫폼 워크플로우
  테이블: `ai_draft`/`admin_*`/이의신청 등)는 **서로 다른 테이블·다른 저장소**다.
- 이 트리에는 `alembic.ini`/`env.py` 러너가 없다 — 우리 백엔드 부팅/테스트/CI 어디에서도
  실행·참조되지 않는다. ERP 브랜치로 옮겨 그쪽 alembic 러너로 적용하기 위한 산출물이다.
- 우리 백엔드 마이그레이션 러너 설정: `backend/alembic.ini` (2행 주석에 이 별개 트리 명시).

## 적용 방법 (ERP 브랜치)

ERP 저장소 `feature/virtual-office-integration` 브랜치의 alembic 트리에 이 리비전을 배치한 뒤
`alembic upgrade head`. 우리 저장소에서는 실행하지 않는다.
