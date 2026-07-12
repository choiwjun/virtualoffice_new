# 15. 실시간 이동서버 스펙 (SkyOffice 이식 · 정본)

> 2026-07-08 작성. D27(포토리얼 웹임베드) 전환에 따른 **자체 실시간 이동서버** 명세.
> WorkAdventure back을 대체한다. 09-realtime-collaboration.md의 프로토콜 정본을 SkyOffice/Colyseus 구현으로 구체화.
> 정본 참조: 09-realtime-collaboration.md(프로토콜), 00-decisions D1/D3/D4/D22, 14-virtual-office-spec.

---

## 1. 스택 & 역할

| 요소 | 선택 | 역할 |
|---|---|---|
| 실시간 서버 | **Colyseus**(Node/TS) | 룸 상태 권위(authoritative), 20Hz tick, 이동/충돌 검증 |
| 상태 동기화 | Colyseus **Schema**(binary delta) | players 상태 델타 브로드캐스트 |
| 음성/영상 | **PeerJS**(≤4명) → **mediasoup/LiveKit**(>4명·회의실) | WebRTC. 회의실은 LiveKit(D24) |
| 영속/도메인 | **FastAPI**(단일 진입) | presence 1~5초 배치 push, 좌석/회의 도메인 로직(D3) |
| 인증 | **FastAPI JWT**(D4) | Colyseus onAuth에서 JWT 검증(콘솔 세션 재사용, 별도 로그인 없음) |

> **원칙(D3)**: Colyseus는 **자기 룸 상태만** 소유. ERP·업무·좌석 DB는 FastAPI 단일 접근. presence는 Colyseus 메모리 권위 → FastAPI 배치 push → DB.

---

## 2. 룸 구조 (Colyseus Room)

- **룸 = 층(floor)** 단위. `OfficeRoom({ office_id, floor_id })`.
- 입장: 클라이언트가 JWT + office/floor로 join → onAuth JWT 검증 → 초기 스냅샷 전송.
- 상태 스키마:
```
OfficeState {
  players: Map<sessionId, Player>
}
Player {
  user_id, name, position{x,y}, facing, status,   // status = D13 7종
  seat_id?, anim,                                  // idle/walk
  last_seq                                         // 재접속 복구용
}
```

---

## 3. 메시지 프로토콜 (09 §5 정본 구체화)

### 클라이언트 → 서버
| 메시지 | 페이로드 | 처리 |
|---|---|---|
| `move_request` | `{target_pos{x,y}, seq}` | 이동 검증 8항목 → 승인 시 position 갱신 |
| `status_change` | `{status}` | focus 토글·external 전환(수동). 자동전이는 서버 판정 |
| `sit_request` | `{seat_id}` | FastAPI 좌석 점유 위임 → 성공 시 working·facing |
| `enter_meeting` | `{room_id}` | **2단계(D24 명시입장)**: ① Colyseus가 근접(2m)·정원 검증 → 입장 가능 통지(프롬프트) ② 사용자 확인 클릭 후 **클라이언트가 FastAPI `POST /api/meetings/join` 직접 호출**(LiveKit 토큰 발급) → 성공 시 meeting 상태 전이. 자동 join 금지 |
| `interact_request` | `{target_user_id}` | 근접 8항목 검증(LOS 광선 포함) |

### 서버 → 클라이언트 (20Hz tick)
| 메시지 | 페이로드 |
|---|---|
| `world_update` | `{server_seq, players[delta], timestamp}` |
| `snapshot` | 전체 상태(입장·재접속 시) |
| `layout_updated` | 레이아웃 배포 시 재로드 신호(D12) |
| `presence_event` | 상태 변경 브로드캐스트 |

> **보완 어휘(09 계승, 정본 포함)**: `resume`(재접속 `last_seq` 기반 스냅샷 요청) · `reject`(프로토콜 버전 협상 거부, D4) · `send_chat`(근접 채팅 — 근접검증 8항목 통과 후). 필드명 정본: `last_seq` / `room_id` / `target_user_id` — 타 문서의 `last_server_seq`·`meeting_id`·`user_b_id` 표기는 이 어휘로 통일한다.

---

## 4. 이동 검증 8항목 (09 §5 / D22)

서버 tick마다 `move_request` 검증:
1. company_id 일치(테넌트 격리) 2. office_id 일치 3. floor_id 일치
4. 좌표 유효·**충돌**(office_layout colliders AABB/polygon) 5. **속도 제한**(tick당 이동거리 상한)
6. 권한(spawn/zone 접근) 7. 좌석 점유 충돌 8. 회의실 정원

- 실패 시: 서버 권위 위치로 **되돌림**(reconcile). 클라이언트 예측과 >0.5m 차이 → Lerp 5프레임 보정.

## 5. 근접 상호작용 검증 8항목 (09 §5)
company_id / office_id / floor_id 일치 · 거리<5m · **벽/유리벽 LOS 광선(가림 시 불가)** · 상대 status≠offline · 요청 쿨다운 1초 · 상대 방해금지/집중모드 미활성.

---

## 6. presence 영속 (D3)

- Colyseus가 메모리 권위 → **1~5초 주기**로 변경분을 FastAPI `POST /api/presence/batch`에 push → DB.
- 자동전이: 좌석도착→working, 회의입장→meeting, **5분 무입력→away**(서버 타이머), 로그아웃→offline + 좌석 자동반납(FastAPI).
- 재접속: `last_seq` 기반 스냅샷 재수신.

## 7. 성능 SLA (D22)
- tick 20Hz(50ms). 아바타 E2E p95 **<500ms**. 동시 **20명(도그푸딩)** / 100명(설계). 근접 메뉴 <200ms.
- 부하검증: 20명 동시 이동 시뮬레이션(미착수 — Phase 후반).

## 8. 배포
- Colyseus 컨테이너 신설(WA 스택 대체). **내부 포트 2567(WSS, Caddy 뒤 내부 전용 — 확정 2026-07-09)**. Caddy가 `/ws/office/*` WSS → Colyseus:2567 라우팅.
- LiveKit·coturn는 회의 화상용으로 유지. wa-* 컨테이너 제거.

---

## 9. 현재 구현 상태
- 🆕 Colyseus 룸·프로토콜·검증: **신규 구축**(WA가 담당하던 것 대체).
- ✅ FastAPI presence 수집(store/stream)·좌석·회의·JWT: 존재 → Colyseus에서 호출.
- 검증된 패턴(SkyOffice MIT)이라 난이도보다 실행량. 착수는 D27 깊이합성 스파이크 통과 이후.
