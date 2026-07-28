/**
 * sceneRooms.ts — 씬의 방(officeV3 `V3_ROOMS`) ↔ DB 방(`GET /api/rooms`) 연결.
 *
 * 정본은 `room.scene_key`다(값 = `V3_ROOMS[].id`). 씬에서 방을 누르면 그 방의 오늘 일정을
 * 띄우는데, "이 방이 어느 DB 방인가"에 정본이 없어 화면이 **이름 문자열 일치**로 때우고
 * 있었다. 씬 라벨이 영어(`Board Room`)라 한국어로 이름 붙인 회사는 한 번도 맞지 않았고
 * (카드가 늘 "이 방의 회의실 정보가 없습니다"), 방 이름을 바꾸면 조용히 끊겼다.
 */

/** 연결 판정에 필요한 최소 계약 — 호출부의 방 타입이 더 넓어도 그대로 받는다. */
export interface SceneLinkableRoom {
  name: string;
  scene_key?: string | null;
}

/**
 * 씬 방 id로 DB 방을 찾는다. 못 찾으면 이름 대조로 폴백한다.
 *
 * 폴백을 남기는 이유: `scene_key`를 아직 안 이어 준 기존 데이터가 갑자기 죽으면, 연결하기
 * 전까지 오피스의 방 카드가 전부 빈다. 다만 **이미 다른 씬 방에 연결된 방은 후보에서 뺀다** —
 * 그 방은 주인이 정해졌고, 이름이 우연히 같다고 두 씬 방이 같은 DB 방을 가리키면 안 된다.
 */
export function resolveSceneRoom<T extends SceneLinkableRoom>(
  rooms: T[],
  sceneRoomId?: string,
  sceneLabel?: string,
): T | undefined {
  if (sceneRoomId) {
    const linked = rooms.find((r) => r.scene_key === sceneRoomId);
    if (linked) return linked;
  }
  const label = (sceneLabel ?? '').trim().toLowerCase();
  if (!label) return undefined;
  return rooms.find((r) => !r.scene_key && r.name?.trim().toLowerCase() === label);
}
