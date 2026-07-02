# 사내 서버 PC 배포 아키텍처 (Docker Compose)

**작성**: 2026-07-02 · **정본 근거**: 02-trd §호스팅(Docker Compose 권장), 11-tech-stack §4.2, OQ5(LiveKit self-host 확정)
**배포 대상**: 사내 온프렘 **로컬 서버 PC 1대** · 단일 조직 도그푸딩(동시 ~20명) · 1인 운영
**오케스트레이션**: **Docker Compose** (Kubernetes 미사용 — 단일 노드·1인 운영에 과잉, ERP도 compose 사용)

---

## 1. 전체 배치 지도 — 무엇이 Docker에 들어가고, 무엇이 안 들어가나

### 서버 PC 1대 (Docker Compose)

| 서비스 | 이미지/빌드 | 포트 | 도입 시기 | 상태 |
|---|---|---|---|---|
| `db` | postgres:17 | 5432(내부) | 지금 | ✅ 구성됨 |
| `backend` | ./backend (FastAPI) | 8000 | 지금 | ✅ 구성됨 |
| `web` | ./web (Next.js 콘솔) | 3000 | Phase 2~3 | 예정 |
| `godot-server` | Godot 헤드리스 export (Linux) | 9000(WSS) | Phase 4 | 예정 |
| `livekit` | livekit/livekit-server | 7880(TCP)+**UDP 범위** | Phase 5 | 예정 ⚠️ |
| `coturn` | coturn/coturn | 3478, 5349(TLS) | Phase 5 | 예정 ⚠️ |
| `proxy` | caddy (TLS 종단/리버스 프록시) | 80/443 | web 도입 시 | 예정 |

- EOD 배치(18:00 KST ERP push)·ERP 동기화 스케줄은 **backend 내 APScheduler**로 실행 — 별도 컨테이너 불필요.
- STT 워커(Phase 5)는 부하 보고 backend 내장 vs 분리 결정.

### Docker에 들어가지 **않는** 것

| 컴포넌트 | 실행 위치 | 이유 |
|---|---|---|
| **Godot 데스크톱 클라이언트** | 각 직원 PC (네이티브 설치) | D11 확정 — Forward+ 최고품질은 네이티브. 자동 업데이트(P7 태스크)로 갱신 |
| Blender→GLB 에셋 파이프라인 | 개발 PC | 빌드타임 도구 |
| ERP(space-daily) | 기존 ERP 서버 (별도) | 우리는 read-only 접속만. 같은 사내망 |

```
[직원 PC들]                          [사내 서버 PC - Docker Compose]
 Godot 클라이언트(네이티브) ──WSS──▶  godot-server (헤드리스, 이동/근접/점유 권위)
 브라우저(관리콘솔)       ──HTTPS─▶  proxy(caddy) ─▶ web(Next.js) / backend(FastAPI)
 화상(클라이언트 내)      ──WebRTC─▶  livekit + coturn (UDP)
                                      backend ──read-only──▶ [ERP dailylog PG] (기존 사내망)
                                      backend ──EOD push───▶ [ERP API]
                                      db(postgres:17, pgdata 볼륨)
```

---

> **확정 (2026-07-02 사용자 인터뷰)**
> - **서버 OS = Linux 설치 예정** (§2 권장안 채택) → LiveKit/coturn 경로 순탄.
> - **회사 VPN 없음 → 외부 공개 필요** (OQ5 종결) → §3이 "사내망 전용"에서 **"인터넷 노출 아키텍처"**로 격상됨. 보안 요구 대폭 상승.

## 2. ⚠️ 성패를 가르는 결정: 서버 PC의 OS — ✅ Linux 확정

| | **Linux (Ubuntu Server 24.04 권장)** | Windows + Docker Desktop |
|---|---|---|
| LiveKit/coturn UDP·host 네트워크 | ✅ 정상 (`network_mode: host` 지원) | ❌ host networking 제약 → 화상 품질/연결 문제 위험 |
| 부팅 시 자동 시작 | ✅ systemd + `restart: unless-stopped` | ⚠️ 로그인 세션 필요(Desktop 앱 기동 전 컨테이너 안 뜸) |
| 라이선스 | 무료 | Docker Desktop 상업용 유료 조건 존재 |
| 리소스 오버헤드 | 낮음 | WSL2 VM 오버헤드 |

**권장**: 서버 PC에 **Ubuntu Server를 설치**하고 Docker Engine(비-Desktop)으로 운영.
Windows를 유지해야 한다면 — Phase 4까지(3D 서버까지)는 가능하나, **Phase 5 화상(LiveKit)에서 벽**에 부딪힐 가능성이 높음. 그 경우 WSL2에 직접 docker engine을 넣거나 화상만 별도 Linux 미니PC로 분리하는 폴백 필요.

## 3. 외부 공개 아키텍처 — VPN 없음 확정 (OQ5 종결, 2026-07-02)

재택·외근자가 **공인 인터넷에서 직접 접속**한다. "사내망이라 안전" 전제 폐기.

### 3.1 도메인·인증서
- **공인 IP = 고정 확정** (2026-07-02) → DDNS 불필요. 도메인 구매 후 A레코드만 지정하면 끝.
- **도메인 = 추후 구매 예정** — 데드라인: **외부(재택) 접속 개시 전** (Let's Encrypt가 도메인 필수).
  - 그때까지 사내 도그푸딩은 도메인 없이 가능: 사내 IP 직결 + Caddy 내부 CA(자체서명 루트를 직원 PC에 배포) 임시 운용.
  - 도메인 구매 시 전환: A레코드 등록 → Caddyfile 도메인 교체 → 인증서 자동 발급 (작업 수분, 코드 무변경).
- 인증서: **Let's Encrypt** — Caddy가 자동 발급·갱신 (80/443 인바운드 필요).
- WSS(D1)·HTTPS·TURN-TLS 모두 이 인증서로 통일.

### 3.2 포트 노출 원칙 — 최소만 연다
| 포트 | 용도 | 공유기/방화벽 포워딩 |
|---|---|---|
| 443/TCP | HTTPS(웹콘솔·API) + WSS(3D) + TURN-TLS(화상 폴백) | ✅ 개방 |
| 80/TCP | Let's Encrypt 검증 + HTTPS 리다이렉트 | ✅ 개방 |
| 7881/TCP + UDP 50000-60000 | LiveKit WebRTC 직결(품질↑) | Phase 5에서 개방 (안되면 TURN-TLS 443 폴백) |
| **5432(DB), 8000(backend), 3000(web)** | 내부 전용 | ❌ **절대 비개방** — compose에서 127.0.0.1 바인딩(적용됨) |

### 3.3 공개 노출 보안 체크리스트 (도그푸딩 시작 전 필수)
- [x] DB 포트 localhost 바인딩 (compose 적용, 2026-07-02)
- [ ] 모든 외부 트래픽 Caddy 단일 진입 → backend/web은 프록시 뒤로 (직접 노출 금지)
- [ ] JWT 시크릿 강한 값 교체 + `ENVIRONMENT=production`
- [ ] 로그인 rate-limit (fastapi 미들웨어 또는 Caddy rate_limit)
- [ ] fail2ban 또는 Caddy 레벨 차단 + ssh 키 인증 전용(패스워드 로그인 off)
- [ ] Docker 자동 보안업데이트(unattended-upgrades) + 이미지 주기 갱신
- [ ] 관리자 기능(POST /erp/sync 등)은 admin 역할 — 적용됨. 추가로 audit_log 기록(P6 태스크)
- [ ] ERP read-only 접속은 서버→ERP 방향 아웃바운드만 (ERP를 외부 노출하지 않음)

## 4. 운영 절차 (1인 운영 기준 최소셋)

### 최초 설치 (서버 PC)
```bash
git clone https://github.com/choiwjun/virtualoffice_new.git && cd virtualoffice_new
cp .env.example .env    # 비밀번호·JWT_SECRET·ERP_DATABASE_URL 입력
docker compose up -d --build
curl http://localhost:8000/health
```

### 업데이트 배포 (레지스트리 불필요 — 단일 서버는 pull&build가 가장 단순)
```bash
git pull && docker compose up -d --build   # 변경된 서비스만 재빌드·재기동
```

### DB 백업 (필수 — pgdata는 PC 디스크 1개에만 존재)
```bash
# 매일 새벽 크론: 덤프 → NAS/타 PC 복사
docker exec vo_db pg_dump -U postgres virtualoffice | gzip > /backup/vo_$(date +%F).sql.gz
```
- 보존: 일 7 + 주 4. **복원 리허설을 도그푸딩 시작 전 1회 필수.**
- KPI/회의록은 인사평가 자료(분기 사용) → 백업 유실 = 평가 데이터 유실.

### 재부팅 내성
- 모든 서비스 `restart: unless-stopped` (구성됨) + Docker 서비스 부팅 자동시작(Linux: `systemctl enable docker`).

### 마이그레이션 (운영 전환 시)
- 지금: `AUTO_CREATE_TABLES=true` (dev 편의).
- 운영: `false` + 우리 DB용 **Alembic** 도입(예정) → 배포 절차가 `git pull → alembic upgrade head → compose up -d --build`로 확장.

## 5. 리소스 계획 (동시 20명 검증 기준, D22)

| 서비스 | RAM 추정 | 비고 |
|---|---|---|
| db + backend + web + proxy | ~2.5GB | |
| godot-server (헤드리스) | ~1GB | 물리 20Hz, 20명 |
| livekit + coturn | ~1.5GB | 1 SFU, 회의 동시 2~3방 |
| **합계** | **~5GB** | **서버 PC 16GB RAM이면 충분, 8GB는 빠듯** |

- GPU 불필요(서버는 렌더링 안 함 — 렌더링은 직원 PC의 네이티브 클라이언트).
- 디스크: SSD 256GB+ (pgdata + 회의 녹음/STT 임시파일 고려).

## 6. 리스크 요약

| 리스크 | 완화 |
|---|---|
| ~~Windows 서버 + LiveKit UDP~~ | ✅ 해소 — Linux 확정 (§2) |
| **인터넷 공개 노출 (VPN 없음)** | §3.2 포트 최소화 + §3.3 보안 체크리스트. 도그푸딩 전 완료 필수 |
| 서버 PC 1대 = SPOF | 도그푸딩 수용(사내). 백업 절차(§4)로 데이터만 보호 |
| 디스크 유실 | 일일 pg_dump 외부 복사 + 복원 리허설 |
| WSS 인증서 관리 | ✅ 단순화 — 공인 도메인 + Let's Encrypt 자동 (Caddy) |
| Docker Desktop 개발PC(Windows)와 서버 환경 차이 | compose 파일 동일 사용, 서버는 Linux Engine |

## 7. 미결(사용자/사내 확인 필요)

- [x] ~~서버 PC OS~~ → **Linux 설치 예정 확정** (2026-07-02)
- [x] ~~VPN 여부~~ → **VPN 없음, 외부 공개 확정** (2026-07-02, §3 참조)
- [x] ~~공인 IP~~ → **고정 IP 확정** (2026-07-02) — DDNS 불필요
- [x] ~~도메인~~ → **추후 구매 예정** (2026-07-02) — 데드라인: 외부 접속 개시 전 (§3.1 임시 운용안 참조)
- [ ] 서버 PC 사양 (RAM 16GB+ 권장 / 디스크 SSD 256GB+)
- [ ] 백업 목적지 (NAS? 다른 PC? — 서버 PC 외부여야 함)
