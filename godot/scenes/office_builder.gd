class_name OfficeBuilder
extends RefCounted

## 테스트용 오피스 장애물 빌더(정적 헬퍼).
## 실 클라이언트는 office_test_map.tscn을 사용하지만, 테스트는 케이스별
## 장애물 배치를 정밀 제어하기 위해 프로그램적으로 구성한다.


## 벽/가구 등 정적 충돌체 생성 후 parent에 부착.
static func wall(parent: Node, center: Vector3, size: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	cs.shape = box
	body.add_child(cs)
	parent.add_child(body)
	body.position = center
	return body
