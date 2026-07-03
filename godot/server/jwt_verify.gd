class_name JwtVerify
extends RefCounted

## HS256 JWT 검증/발급 (D4: FastAPI 자체 시크릿 HS256).
##
## 서버는 FastAPI가 발급한 JWT를 "동일 시크릿"으로 재검증한다.
## 서명 검증은 수신한 header.payload 문자열 원본에 대해 HMAC-SHA256을 재계산하므로
## Python(jose) 직렬화 방식과 무관하게 상호운용된다.


static func _b64url_decode(s: String) -> PackedByteArray:
	var t := s.replace("-", "+").replace("_", "/")
	while t.length() % 4 != 0:
		t += "="
	return Marshalls.base64_to_raw(t)


static func _b64url_encode(bytes: PackedByteArray) -> String:
	var s := Marshalls.raw_to_base64(bytes)
	return s.replace("+", "-").replace("/", "_").rstrip("=")


static func _hmac_sha256(secret: String, msg: String) -> PackedByteArray:
	var ctx := HMACContext.new()
	ctx.start(HashingContext.HASH_SHA256, secret.to_utf8_buffer())
	ctx.update(msg.to_utf8_buffer())
	return ctx.finish()


## 토큰 검증. { "valid": bool, "reason": String, "claims": Dictionary }
static func verify(token: String, secret: String) -> Dictionary:
	var parts := token.split(".")
	if parts.size() != 3:
		return { "valid": false, "reason": "malformed", "claims": {} }
	var signing_input: String = parts[0] + "." + parts[1]
	var expected := _hmac_sha256(secret, signing_input)
	var actual := _b64url_decode(parts[2])
	if expected != actual:
		return { "valid": false, "reason": "bad_signature", "claims": {} }
	var payload_json := _b64url_decode(parts[1]).get_string_from_utf8()
	var payload = JSON.parse_string(payload_json)
	if typeof(payload) != TYPE_DICTIONARY:
		return { "valid": false, "reason": "bad_payload", "claims": {} }
	if payload.has("exp"):
		var now := Time.get_unix_time_from_system()
		if float(payload["exp"]) < now:
			return { "valid": false, "reason": "expired", "claims": payload }
	return { "valid": true, "reason": "", "claims": payload }


## 테스트/도구용 발급(HS256). 실 운영 토큰은 FastAPI가 발급.
static func mint(claims: Dictionary, secret: String) -> String:
	var header := { "alg": "HS256", "typ": "JWT" }
	var h := _b64url_encode(JSON.stringify(header).to_utf8_buffer())
	var p := _b64url_encode(JSON.stringify(claims).to_utf8_buffer())
	var sig := _b64url_encode(_hmac_sha256(secret, h + "." + p))
	return h + "." + p + "." + sig
