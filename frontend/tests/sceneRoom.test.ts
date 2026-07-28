import { describe, it, expect } from 'vitest';
import { resolveSceneRoom } from '../lib/sceneRooms';

/**
 * 씬의 방 ↔ DB 방 연결. 정본은 room.scene_key(= officeV3 V3_ROOMS[].id).
 * 이름 문자열 일치는 scene_key를 아직 안 이어 준 데이터용 폴백일 뿐이다.
 */
describe('resolveSceneRoom', () => {
  const linked = { id: 'a', name: '대회의실', scene_key: 'boardroom' };
  const unlinkedEnglish = { id: 'b', name: 'Board Room', scene_key: null };
  const other = { id: 'c', name: '소회의실', scene_key: 'meeting-a' };

  it('scene_key로 찾는다 — 방 이름이 씬 라벨과 전혀 달라도 된다', () => {
    expect(resolveSceneRoom([linked, other], 'boardroom', 'Board Room')).toBe(linked);
  });

  it('한국어로 이름 붙인 회사도 연결만 하면 뜬다 (이름 대조로는 영영 못 맞추던 경우)', () => {
    expect(resolveSceneRoom([linked], 'boardroom', 'Board Room')?.name).toBe('대회의실');
  });

  it('scene_key가 이름 대조보다 우선한다', () => {
    // 이름은 unlinkedEnglish가 씬 라벨과 같지만, 연결된 방이 있으면 그쪽이 정본이다.
    expect(resolveSceneRoom([unlinkedEnglish, linked], 'boardroom', 'Board Room')).toBe(linked);
  });

  it('연결 전에는 이름 대조로 폴백한다 — 기존 데이터가 갑자기 죽지 않게', () => {
    expect(resolveSceneRoom([unlinkedEnglish], 'boardroom', 'Board Room')).toBe(unlinkedEnglish);
  });

  it('폴백은 공백·대소문자를 무시한다', () => {
    expect(resolveSceneRoom([{ id: 'd', name: '  board room  ' }], 'boardroom', 'Board Room')?.id).toBe('d');
  });

  it('이미 다른 씬 방에 연결된 방은 이름이 같아도 고르지 않는다 — 주인이 정해진 방이다', () => {
    const claimed = { id: 'e', name: 'Board Room', scene_key: 'lounge' };
    expect(resolveSceneRoom([claimed], 'boardroom', 'Board Room')).toBeUndefined();
  });

  it('맞는 방이 없으면 undefined — 화면이 "정보 없음"을 정직하게 말할 수 있게', () => {
    expect(resolveSceneRoom([other], 'boardroom', 'Board Room')).toBeUndefined();
    expect(resolveSceneRoom([], 'boardroom', 'Board Room')).toBeUndefined();
  });

  it('씬 라벨이 비어 있으면 폴백하지 않는다 — 빈 문자열이 아무 방이나 집으면 안 된다', () => {
    expect(resolveSceneRoom([{ id: 'f', name: '' }], undefined, '')).toBeUndefined();
  });
});
