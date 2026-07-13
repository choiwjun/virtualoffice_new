/** 백엔드 에러 코드(detail) → 한국어 메시지 매핑 */
const ERROR_MESSAGES: Record<string, string> = {
  insufficient_permissions: '권한이 없습니다',
  team_scope_violation: '자기 팀 소속만 처리할 수 있습니다',
  trip_not_editable: '신청 상태에서만 수정할 수 있습니다',
  report_required: '결과 보고를 입력해주세요',
  invalid_status_transition: '현재 상태에서 허용되지 않는 변경입니다',
  cannot_delete_processed_trip: '처리된 출장은 삭제할 수 없습니다',
  cannot_delete_completed_work_log: '완료된 업무는 삭제할 수 없습니다(평가 근거 보존)',
  report_already_submitted: '제출된 보고서는 수정할 수 없습니다',
  cannot_delete_submitted_report: '제출된 보고서는 삭제할 수 없습니다',
  room_time_conflict: '해당 시간대에 이미 예약된 회의가 있습니다',
  room_capacity_exceeded: '회의실 정원이 초과되었습니다',
  meeting_not_joinable: '취소되었거나 종료된 회의입니다',
  adjusted_score_out_of_range: '조정 점수는 원점수 ±10% 이내여야 합니다',
  objection_window_expired: '이의신청 기한(공개 후 7일)이 지났습니다',
  already_finalized: '이미 확정된 평가입니다',
  objection_in_progress: '이의신청 처리 중에는 확정할 수 없습니다',
  retry_limit_exceeded: '재시도 한도(3회)를 초과했습니다',
  invalid_objection_category: '이의신청 유형이 올바르지 않습니다',
  empty_content: '내용을 입력해주세요',
  not_channel_member: '이 채널에 참여할 수 없습니다',
};

/** 알려진 코드면 한국어 메시지, 아니면 null (호출부에서 code 원문으로 폴백) */
export function mapApiError(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? null;
}
