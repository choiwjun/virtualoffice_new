extends GutTest

## JWT HS256 검증기(D4) — 자체 왕복 + 변조/만료 거부 + 실 FastAPI 토큰 상호운용.

const SECRET := "shared-hs256-secret"


func test_mint_verify_roundtrip() -> void:
	var claims := { "sub": "42", "role": "employee", "exp": int(Time.get_unix_time_from_system()) + 3600 }
	var tok := JwtVerify.mint(claims, SECRET)
	var r := JwtVerify.verify(tok, SECRET)
	assert_true(r["valid"], "정상 서명 검증 통과")
	assert_eq(str(r["claims"]["sub"]), "42", "sub 클레임 복원")


func test_wrong_secret_rejected() -> void:
	var tok := JwtVerify.mint({ "sub": "1" }, SECRET)
	var r := JwtVerify.verify(tok, "other-secret")
	assert_false(r["valid"], "다른 시크릿 → 서명 불일치")
	assert_eq(r["reason"], "bad_signature")


func test_tampered_payload_rejected() -> void:
	var tok := JwtVerify.mint({ "sub": "1" }, SECRET)
	var parts := tok.split(".")
	# payload 변조 후 원 서명 유지 → 검증 실패해야 함
	var forged := JwtVerify._b64url_encode(JSON.stringify({ "sub": "999" }).to_utf8_buffer())
	var tampered: String = parts[0] + "." + forged + "." + parts[2]
	var r := JwtVerify.verify(tampered, SECRET)
	assert_false(r["valid"], "변조 payload 거부")


func test_expired_rejected() -> void:
	var claims := { "sub": "1", "exp": int(Time.get_unix_time_from_system()) - 10 }
	var tok := JwtVerify.mint(claims, SECRET)
	var r := JwtVerify.verify(tok, SECRET)
	assert_false(r["valid"], "만료 토큰 거부")
	assert_eq(r["reason"], "expired")


func test_malformed_rejected() -> void:
	var r := JwtVerify.verify("not-a-jwt", SECRET)
	assert_false(r["valid"])
	assert_eq(r["reason"], "malformed")


# 상호운용: 실 FastAPI(PyJWT HS256)가 발급한 토큰을 동일 시크릿으로 검증.
func test_interop_real_fastapi_token() -> void:
	var path := "res://tests/fixtures/backend_token.json"
	if not FileAccess.file_exists(path):
		pending("fixtures/backend_token.json 없음 — 백엔드로 재생성 필요")
		return
	var f := FileAccess.open(path, FileAccess.READ)
	var data = JSON.parse_string(f.get_as_text())
	f.close()
	assert_not_null(data, "픽스처 파싱")
	var r := JwtVerify.verify(data["token"], data["secret"])
	assert_true(r["valid"], "실 FastAPI 토큰 HS256 상호운용 검증: %s" % r["reason"])
	assert_eq(str(r["claims"]["sub"]), "42", "FastAPI 토큰 sub 복원")
	# 잘못된 시크릿이면 거부되어야 함(위조 방어)
	var bad := JwtVerify.verify(data["token"], "wrong")
	assert_false(bad["valid"], "다른 시크릿으로는 실 토큰도 거부")
