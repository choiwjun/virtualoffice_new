/**
 * KST 날짜 유틸 (D19: UTC 저장, KST 표시)
 * toISOString()은 UTC 기준이라 KST 00~09시에 '오늘'이 전날로 잡힌다.
 * Asia/Seoul 타임존으로 포맷하여 KST 달력 날짜를 얻는다.
 */
const KST_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 주어진 시각의 KST 달력 날짜 ('YYYY-MM-DD') */
export function kstDateString(d: Date): string {
  return KST_DATE_FORMAT.format(d);
}

/** 오늘 날짜 ('YYYY-MM-DD', Asia/Seoul 기준) */
export function kstToday(): string {
  return kstDateString(new Date());
}
