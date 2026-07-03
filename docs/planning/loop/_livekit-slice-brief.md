가상오피스 회의(D24) LiveKit 실 AccessToken 발급 슬라이스 — Phase 5 LiveKit+STT 전체(blocked-work-registry B-03) 중 이 개발 환경(Windows 로컬, Docker 가용, LiveKit 서버/STT 엔진 부재)에서 실제 구현·검증 가능한 부분만 진행한다. 실 LiveKit 서버 룸 생성·화상·Egress·STT·AI 요약은 서버/엔진 부재로 범위 밖(B-03 환경차단 유지). B-01 Godot 3D 클라이언트는 Phase 1 본체(엔진 부재·렌더링 검증 불가)라 이 슬라이스에 포함하지 않는다.

공통 제약:
- 정본(SSOT): docs/planning/00-decisions.md D24(명시적 입장, LiveKit는 FastAPI 경유 토큰 발급), docs/api/management-api.yaml, docs/api/realtime-server-api.yaml.
- venv/pytest: PY="$(pwd)/backend/.venv/Scripts/python.exe"; cd backend && "$PY" -m pytest -q -p no:cacheprovider. 상대경로 exe 직접 실행은 실패하므로 절대경로 변수 필수.
- 기존 컨벤션 재사용(app/services/*, app/api/meetings.py, app/config.py). 병렬 컨벤션 금지.
- 회귀 베이스라인 338 passed / 25 skipped / 0 failed 는 절대 회귀하지 않는다.
- **하위호환 필수**: LiveKit 미설정(기본)이면 기존 결정적 stub 토큰(FastAPI 자체 JWT, room_name=meeting-{id}) 동작을 그대로 유지한다(계약/통합 테스트 무회귀). LiveKit 설정 시에만 실 LiveKit AccessToken을 발급한다(feature flag).
- 완료 게이트: 타깃 검증 → ai-slop 정리 스윕 → architect 3-레인 리뷰(CLEAR) → executor 레드팀/QA → 전체 회귀 무회귀 → 품질게이트 JSON → checkpoint.

@goal: 회의 입장 LiveKit 실 AccessToken 발급(설정 시) + self-host 배포 스캐폴드
POST /meetings/{id}/join 의 livekit_token 을 FastAPI 자체 JWT stub 에서 조건부 LiveKit 실 AccessToken 으로 승격한다.
1. 의존성: backend/requirements.txt 에 livekit-api 추가(설치).
2. 설정: app/config.py 에 livekit_url / livekit_api_key / livekit_api_secret 추가(기본 빈 문자열=미설정). 미설정이면 stub, 설정(키+시크릿 존재)이면 실 토큰.
3. 서비스: app/services/livekit_service.py 신설 — issue_join_token(room, identity, name?) 헬퍼. LiveKit 설정 시 livekit.api.AccessToken(api_key, api_secret).with_identity(identity).with_grants(VideoGrants(room_join=True, room=room)).with_ttl(...).to_jwt() 로 실 토큰; 미설정 시 기존 create_access_token 기반 결정적 stub 토큰을 반환(하위호환). 단일 진입점.
4. 배선: meetings.py join_meeting 이 create_access_token 인라인 대신 issue_join_token(meeting.livekit_room, str(current_user.user_id)) 사용. CANCELLED/COMPLETED 409 가드·상태 전이·participant upsert·room_name 결정성은 불변 유지.
5. 배포 스캐폴드: docker-compose.yml 에 livekit-server(+coturn) self-host 서비스 추가(.env 로 LIVEKIT_URL/KEY/SECRET 주입, 포트/설정 주석). backend env 에 LIVEKIT_* 주입. `docker compose config` 로 유효성 확인(실 부팅/화상 e2e 는 범위 밖).
6. 문서: .env.example 에 LIVEKIT_URL/API_KEY/API_SECRET(기본 빈=stub) 추가. docs/deployment/onprem-docker.md 에 LiveKit 배포/토큰 노트.
7. registry: blocked-work-registry.md B-03/B-07 를 "토큰 발급 슬라이스 해소, 실 서버 룸/화상/STT 는 환경차단 유지" 로 갱신.
테스트(backend/tests): (a) LiveKit 설정 시 issue_join_token 이 실 LiveKit AccessToken 발급 — 디코드하여 iss=api_key, video grant roomJoin=true, room=대상, sub=identity 검증; (b) 미설정 시 stub fallback(기존 형식) 무회귀; (c) join 계약(200+livekit_token+room_name=meeting-{id}, CANCELLED/COMPLETED 409) 무회귀. 실 LiveKit 서버 접속·룸 생성·화상·STT 는 검증 대상 아님(환경차단).
