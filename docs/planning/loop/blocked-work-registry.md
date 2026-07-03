# 환경 차단 작업 레지스트리 (Blocked Work Registry)

**스토리**: G011 — 환경 차단 작업을 durable blocker로 등록
**작성**: ultragoal 실행 세션 (관리 API G001~G010 완료 후)
**정본 참조**: `docs/planning/00-decisions.md`, `docs/planning/10-roadmap.md`, `docs/planning/12-tasks.md`, `docs/planning/loop/final-planning-approval.md`

## 목적

관리 API(G001~G010) 구현 중 **이 개발 환경(로컬, PostgreSQL/실 ERP/GPU/Godot/LiveKit 부재)에서 실행·검증이 불가능한 작업**을 코드로 억지 완결하지 않고 여기 durable하게 기록한다. 각 항목은 **실행 불가 사유 + 잠금 분류 + 해소 선행조건 + 코드 측 현재 상태(방어 구현 여부)**를 명시한다.

분류(status):
- `human_blocked` — 사람의 조치(자격증명 발급, 도메인 구매, 하드웨어/런타임 확보, 제품 정책 비준)가 선행되어야 진행 가능. 자동 진행 불가.
- `phase_blocked` — 로드맵상 후속 Phase(3D/실시간/화상)에 속해 현 관리 API Phase 범위 밖.
- `followup` — 코드로 방어/스캐폴딩은 완료했고, 라이브 환경/후속 스토리에서 검증·활성화만 남음.

---

## A. 원 기획(final-planning-approval) 정의 환경차단 — Phase 후속

| ID | 항목 | 분류 | 실행 불가 사유 | 해소 선행조건 |
|----|------|------|----------------|----------------|
| B-01 | Godot 3D 클라이언트 (Phase 1) | phase_blocked (헤드리스 로직 슬라이스 진행 중) | GPU 렌더링·실 GLB 에셋·에디터 런타임은 부재로 여전히 차단. **헤드리스 GUT로 검증 가능한 로직 슬라이스는 진행**: 아바타 이동/충돌/좌석/근접/A*(`scenes/avatar.gd`), JWT HS256 검증(`server/jwt_verify.gd`), **office_layout(05 스키마) → 3D 씬 + 아바타용 obstacle_cells/seats/spawn 파생 로더(`scenes/office_layout_loader.gd`)**. 실 GPU 40아바타 FPS·GLB 임포트·export 빌드만 GPU/에셋 차단. | Godot GPU 빌드/런 환경, 에셋 레지스트리(asset 테이블) 실 GLB/tscn, export 파이프라인 |
| B-02 | 헤드리스 실시간 서버 + 클라이언트 WSS 네트워킹 (Phase 4) | phase_blocked | 실시간 서버 런타임·WSS 인프라 부재. `docs/api/realtime-server-api.yaml`은 계약만 존재. | Phase 4 실시간 서버 구현, presence 좌표 브로드캐스트 인프라 |
| B-03 | LiveKit 화상 + STT 회의록 런타임 (Phase 5) | phase_blocked (토큰 발급+배포 스캐폴드 슬라이스는 해소 → B-07) | LiveKit 서버·Egress·STT 엔진(한국어 화자분리)·AI 후처리 런타임 부재. **회의 입장 토큰(실 AccessToken 조건부 발급) + livekit/coturn compose opt-in 스캐폴드는 완료(B-07)** — 실 서버 룸 생성/화상/STT/AI만 남음. | LiveKit 서버 배포 + STT 엔진 + AI 요약 파이프라인 |
| B-04 | 선행 스파이크 S1~S4 | phase_blocked | S1(3D 성능), S2(STT 정확도<5% 누락률, D22), S3(실시간 부하), S4(에셋 파이프라인) — 각 후속 Phase 검증용 스파이크. | 해당 Phase 하드웨어/런타임 확보 |
| B-05 | ERP 라이브 read-only DB 접속 (OQ10) | human_blocked | dailylog PostgreSQL read-only 계정 미발급. 현재 `MockErpReader`로만 동작(`ERP_DATABASE_URL` 비어있음). | ERP DB 계정/접속정보(OQ10) 발급 → `ERP_DATABASE_URL` 설정 시 `PostgresErpReader` 자동 전환 |
| B-06 | 공인 도메인 구매 (R-d) | human_blocked | 도메인 미구매. 외부 공개(Caddy TLS)·CORS 확정 불가. | 도메인 구매 + DNS + Caddy 인증서 |

---

## B. 관리 API 구현 중 누적된 환경차단 (G005~G010)

### G005 회의 + 예약
| ID | 항목 | 분류 | 사유 / 코드 현재 상태 | 해소 선행조건 |
|----|------|------|------------------------|----------------|
| B-07 | LiveKit 실 룸 생성/토큰 (D24) | 🟡 부분해소(토큰 발급) · 룸/미디어는 phase_blocked(→B-03) | **토큰 슬라이스 해소**: `join`이 `app/services/livekit_service.issue_join_token`으로 발급 — `LIVEKIT_API_KEY/SECRET` 설정 시 실 LiveKit AccessToken(VideoGrants room_join, iss=api_key/sub=user_id/room/TTL 6h), 미설정 시 결정적 stub(하위호환). `docker-compose` livekit/coturn opt-in profile 스캐폴드 추가(`docker compose config` 검증). 테스트 `tests/services/test_livekit_service.py`. 실 룸 생성/미디어 연동은 B-03. | (토큰 해소) 실 LiveKit 서버 룸 생성/미디어는 B-03 런타임 |
| B-08 | 예약 충돌 TOCTOU → DB 배타 제약 | followup | 온프렘 단일 인스턴스 전제라 현재 위험 낮음. 코드 주석으로 명시. 다중 인스턴스 확장 시 PostgreSQL `EXCLUDE USING gist (room_id WITH =, tstzrange(scheduled_at, scheduled_end) WITH &&)` 승격 필요. | 다중 인스턴스 배포 결정 시 마이그레이션 |

### G006 회의록 + STT
| ID | 항목 | 분류 | 사유 / 코드 현재 상태 | 해소 선행조건 |
|----|------|------|------------------------|----------------|
| B-09 | STT 실 파이프라인 (D5, LiveKit Egress→화자분리→AI요약) | phase_blocked(→B-03/B-04) | `stt_draft` 저장·조회 계약만 구현. 실 STT 생성은 외부 파이프라인이 채우기 전까지 NULL. | B-03 LiveKit + STT 엔진, B-04 S2 스파이크 |
| B-10 | STT 정확도 측정 (누락률<5%, D22) — 계약 `test_stt_accuracy_measurement` skip | phase_blocked(→B-04) | 실 STT 없이 정확도 측정 불가. 계약 테스트 skip 유지(reason=Phase4+ S2). | B-04 S2 스파이크 |

### G008 KPI
| ID | 항목 | 분류 | 사유 / 코드 현재 상태 | 해소 선행조건 |
|----|------|------|------------------------|----------------|
| B-11 | KPI AI 서술 초안 실 생성 (D14-e) | phase_blocked | 정량 점수는 결정론 코드로 완결. AI 서술(`ai_draft`)은 결정론 placeholder(`ai_draft_pending`)만. 실 LLM 호출 미연동. | AI 모델 연동 런타임 |
| B-12 | 확정 KPI ERP push (D15/D17) | human_blocked(→B-05) | `confirm`은 `final_score`/`finalized_at` 로컬 확정만. 실 ERP push(`pushed_to_erp`/`pushed_at`) 미연동. | B-05 ERP 라이브 DB/API |
| B-13 | 분기 집계 배치 `POST /kpi/aggregate` — 계약 `test_kpi_quarterly_aggregation` skip | followup(→B-16) | 202 스텁 + `aggregate_user_period` 로직 구현·단위검증. 실 스케줄 배치 실행은 미검증. | B-16 스케줄러 런타임 |

### G009 동기화 + 감사
| ID | 항목 | 분류 | 사유 / 코드 현재 상태 | 해소 선행조건 |
|----|------|------|------------------------|----------------|
| B-14 | 감사 로그 생산자 훅 (`audit_service.py`) | ✅ resolved (2026-07-03) | **구현 완료**: `app/services/audit_service.py`(`record_audit` — 트랜잭션 stage-only, commit/flush 없음) + seats(assign/unassign)·meetings(create/cancel)·kpi(adjust/confirm/objection)·layouts(deploy/rollback) 감사 훅 배선. 도메인 뮤테이션과 **원자적**(commit 이전 stage → 실패 시 동반 롤백). D20 감사추적 컴플라이언스 컨트롤 작동. 테스트 15건(`tests/redteam/test_audit_producer_redteam.py`, 원자성/멱등/거부 무감사 포함) + architect 세 레인 CLEAR+APPROVE. 전체 회귀 297 passed/28 skipped/0 fail. | (해소됨) 잔여 LOW 후속은 §D 참조 |
| B-15 | 레거시 `POST /api/erp/sync` deprecation | ✅ resolved (2026-07-03) | **deprecate + 로깅 통일**: `erp.py` 레거시 트리거에 `deprecated=True` + RFC 8594 Deprecation/Link(후속=`/sync/erp`) 헤더, 하위호환 `SyncResultOut` 유지하되 정본 `sync.py`처럼 ErpSyncLog(성공 SUCCESS/실패 FAILED, rollback 후 재기록) 기록 → 모니터링 사각 제거. architect 재리뷰 세 레인 CLEAR. | (해소됨) 최종 물리 제거는 외부 소비자 이전 후 |

### G010 보안 + 스케줄러
| ID | 항목 | 분류 | 사유 / 코드 현재 상태 | 해소 선행조건 |
|----|------|------|------------------------|----------------|
| B-16 | APScheduler 상시 실행 + 실 cron 발화 (D17) | ✅ resolved(배포 배선 + 부팅/재시작 검증) · 실시각 발화는 운영 관측 | **배포 배선 갭 수정**: `docker-compose.yml` backend env에 `SCHEDULER_ENABLED` 주입(배포 문서엔 'true로 설정' 안내가 있었으나 compose 미배선이라 `.env`→컨테이너 전달이 끊겨 있던 실버그). `main.lifespan`에 스케줄러 기동/종료 로그 추가(운영 관측). **실 Docker 검증**: `SCHEDULER_ENABLED=true` 기동 시 로그 `APScheduler started: 4 jobs registered` + `/health` 200 + `docker restart` 후 재기동(재시작 지속성), `false`(기본)면 미기동(컨테이너는 healthy). 증거: `backend/artifacts/b16-docker-scheduler-verify.txt`. | (배선·부팅·재시작 해소) 실제 18:00/21:00 등 **시각 발화**는 배포 후 달력상 관측만 남음(코드·배선·기동은 검증됨) |
| B-17 | 단일 인스턴스 확정 / PostgreSQL `pg_advisory_lock` 다중 인스턴스 | ✅ resolved(단일 확정) · 다중 이연 | **D21 단일 인스턴스 온프렘 확정**: `build_scheduler` 4잡에 `max_instances=1`+`coalesce=True` 명시(중복 실행·미스파이어 누적 방지). `advisory_lock`은 PostgreSQL만 실행/그외 no-op 유지. 다중 인스턴스 락 경합 실검증은 현 단일 전제라 불필요. | (단일 해소) 다중 인스턴스 채택 시 PG 배포 검증 |
| B-18 | 공휴일 캘린더 (daily_reports 스킵) | ✅ resolved (2026-07-03) | **정적 공휴일 소스 구현**: `app/services/holidays.py`(`is_kr_holiday` — 양력 고정 + 2026~2027 음력/대체공휴일, **제헌절 7/17 재지정** 반영, 외부 API/네트워크 불필요). `daily_reports_push`가 공휴일 스킵(주말은 cron). 미커버 연도(2028+)는 WARN으로 갱신 촉구. architect 재리뷰 세 레인 CLEAR. | (해소됨) 2028+ 관보 확정 시 테이블 갱신(WARN이 촉구) |
| B-19 | 실 ERP 라이브 push (daily_status_push 전송) | human_blocked(→B-05) | `daily_status_push` 레코드 생성(멱등)만. 실 ERP API 전송(`erp_response`/`pushed_at` 갱신·재시도)은 MockErpReader로만 검증. | B-05 ERP 라이브 접속 |
| B-20 | `kpi_result.ai_draft` JSONB NULL 멱등 — Postgres 검증 | followup | SQLite에서 `is_(JSON.NULL)` 멱등 검증 완료. Postgres JSONB SQL NULL vs `'null'` 동작 미검증. | PostgreSQL 배포 시 회귀 검증 |
| B-21 | `daily_status_push (user_id, push_date, target)` UNIQUE 제약 | followup | 현재 SELECT-후-insert 멱등 + advisory lock으로 방어. DB UNIQUE 제약(심층방어)은 미추가(테이블 스키마 변경). | 다중 인스턴스/방어선 강화 시 마이그레이션 |

---

## C. 잠금 분류 요약

- **human_blocked**(사람 조치 필수): B-05(ERP DB 계정), B-06(도메인), B-12·B-19(ERP push=B-05 종속).
- **phase_blocked**(후속 Phase): B-01(Godot), B-02(실시간 WSS), B-03(LiveKit/STT 서버·엔진 — 토큰/스캐폴드 슬라이스는 B-07로 부분해소), B-04(스파이크), B-09·B-10(STT 종속), B-11(AI 서술).
- **followup**(코드 방어 완료, 라이브/후속 검증만): B-08(TOCTOU 제약), B-13(분기배치), B-20(JSONB Postgres), B-21(UNIQUE 방어선).
- **✅ resolved(구현 완료)**: B-14(감사 생산자 훅, 2026-07-03), **B-15**(레거시 sync deprecate+로깅 통일), **B-16**(스케줄러 상시구동 — compose `SCHEDULER_ENABLED` 배선 + Docker 부팅/재시작 실검증), **B-17**(단일 인스턴스 확정 max_instances=1/coalesce — 다중 PG 검증은 이연), **B-18**(정적 공휴일 소스 + daily_reports 스킵, 제헌절 재지정 반영).
- **🟡 부분해소**: **B-07**(LiveKit 입장 토큰 실 AccessToken 조건부 발급 + compose livekit/coturn opt-in 스캐폴드 — 실 서버 룸/화상/STT는 B-03 유지).

## D. 정책상 남은 결정(제품 오너 비준 대기)

- ~~B-15 레거시 `/api/erp/sync` deprecation 여부~~ → **결정·반영 완료(2026-07-03)**: deprecate + ErpSyncLog 로깅 통일(제거 아님, 하위호환 유지). 최종 물리 제거는 외부 소비자 이전 후 별도.
- ~~B-14 감사 생산자 훅 별도 스토리 착수 필요~~ → **완료(2026-07-03)**. D20 컴플라이언스 컨트롤 활성화됨. 잔여 후속: (1) ~~`ip_address`/`user_agent` 미배선~~ → **완료** (`record_audit`가 `Request`에서 도출, 9개 훅 배선, 전용 테스트 `test_audit_captures_client_ip_and_user_agent`), (2) 자율석 occupy/release·회의록 confirm은 D20 감사 어휘 밖(이력은 `SeatAssignmentHistory` 보유 — 스코프 경계, INFO 비차단), (3) staged-후-commit실패(IntegrityError) 롤백 경로 회귀 테스트 보강(LOW 비차단 — 단일 인스턴스 온프렘 전제라 트리거 결정론 확보 어려움).
- **B-22 (설계 WATCH, 후속)**: ERP 증분 동기화가 contract §1.3 의사코드의 `updated_at` 델타가 아니라 **전체 로스터 대조**(`erp_incremental_sync`==`erp_full_reconciliation`, `sync_users` 재사용)로 구현됨. 현재 `ErpReader.fetch_users(company_id)`가 델타 파라미터 없이 전체 로스터를 반환하는 계약이라 안전·정확(하드삭제 감지 포함)하며 중복코드가 없다 — **의도적 설계 결정**. 단, 향후 실 ERP 리더가 진짜 `updated_at`-델타(변경분만 반환)를 구현하면 미변경 사용자를 대량 오(誤)soft-delete할 위험 → 델타 리더 도입 시 증분/전체 로직 분리 + 회귀 가드 필요(현재 리더 계약 유지 하에서는 봉쇄, architect G003 F2).

## E. 비고

- G001~G010 관리 API는 모두 계약/레드팀/architect 세 레인 CLEAR로 완료됨. 위 항목들은 관리 API 코드 결함이 아니라 **환경/런타임/후속 Phase 의존**이다.
- 코드 측에서는 각 차단 지점에 방어(멱등 upsert, no-op advisory, 결정론 placeholder, 저장-조회 계약 stub)를 구현해 라이브 전환 시 최소 변경으로 활성화되도록 했다.
