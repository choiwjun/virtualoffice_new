/**
 * 좌석 제도판의 색·용어 정본.
 *
 * SeatCanvas(konva, ssr:false)와 편집기 페이지의 범례가 같은 값을 봐야 한다.
 * SeatCanvas에서 export하면 페이지가 konva를 서버 번들로 끌어오므로 값만 여기에 둔다.
 *
 * 용어 라벨이 여기 있는 이유: DB enum(free/available/deployed)을 화면에 그대로 노출하면
 * 총무 담당자가 읽을 수 없다. 사람이 읽는 말은 한 곳에서만 정의한다.
 */

export interface SeatStyle {
  fill: string;
  stroke: string;
}

/** 상태별 좌석 색 — 채도를 낮춰 도면 위에서 형광으로 튀지 않게. */
export const SEAT_STYLE: Record<string, SeatStyle> = {
  available: { fill: '#FFFFFE', stroke: '#4E8A5C' }, // 빈자리
  occupied: { fill: '#EAEFF8', stroke: '#3D5A9E' }, // 사용 중(파랑 — 빨강은 오류 신호라 쓰지 않는다)
  reserved: { fill: '#FBF3E2', stroke: '#A8792B' }, // 예약됨
  disabled: { fill: '#EDEBE6', stroke: '#A9A296' }, // 사용 불가
};

export const SEAT_FALLBACK: SeatStyle = { fill: '#F1F0EC', stroke: '#8C8578' };

export const seatStyle = (status: string): SeatStyle => SEAT_STYLE[status] ?? SEAT_FALLBACK;

/** 좌석 상태(seat.status) 한국어. */
export const SEAT_STATUS_LABEL: Record<string, string> = {
  available: '빈자리',
  occupied: '사용 중',
  reserved: '예약됨',
  disabled: '사용 안 함',
};

/** 좌석 종류(seat.type) 한국어. free=아무나 앉는 자리, fixed=지정된 사람 자리. */
export const SEAT_TYPE_LABEL: Record<string, string> = {
  free: '자율석',
  fixed: '고정석',
  temp: '임시석',
  partner: '협력사석',
};

/** 레이아웃 버전 상태(office_layout.status) 한국어. */
export const LAYOUT_STATUS_LABEL: Record<string, string> = {
  draft: '작성 중',
  validated: '검사 통과',
  deployed: '반영됨',
  archived: '지난 버전',
};

export const seatStatusLabel = (s: string) => SEAT_STATUS_LABEL[s] ?? s;
export const seatTypeLabel = (t: string) => SEAT_TYPE_LABEL[t] ?? t;
export const layoutStatusLabel = (s: string) => LAYOUT_STATUS_LABEL[s] ?? s;
