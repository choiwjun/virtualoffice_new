'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove, type User } from '@/lib/auth';

interface Trip {
  id: number;
  user_id: number;
  destination: string;
  purpose: string;
  start_date: string;
  end_date: string;
  status: string;
  note: string | null;
  report: string | null;
  approver_id: number | null;
  decided_at: string | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface Employee {
  id: number;
  name: string;
}

type StatusTab = '' | 'requested' | 'approved' | 'rejected' | 'completed' | 'cancelled';

const TABS: { value: StatusTab; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'requested', label: '신청' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '반려' },
  { value: 'completed', label: '완료' },
  { value: 'cancelled', label: '취소' },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  requested: { label: '신청', color: 'bg-amber-100 text-amber-700' },
  approved: { label: '승인', color: 'bg-green-100 text-green-700' },
  rejected: { label: '반려', color: 'bg-red-100 text-red-700' },
  cancelled: { label: '취소', color: 'bg-gray-100 text-gray-600' },
  completed: { label: '완료', color: 'bg-blue-100 text-blue-700' },
};

interface TripFormData {
  destination: string;
  purpose: string;
  start_date: string;
  end_date: string;
  note: string;
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

const DEFAULT_FORM: TripFormData = {
  destination: '',
  purpose: '',
  start_date: '',
  end_date: '',
  note: '',
};

function formatDateTime(s: string | null): string {
  if (!s) return '—';
  return s.replace('T', ' ').slice(0, 16);
}

export default function TripPage() {
  const [user, setUser] = useState<User | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [employees, setEmployees] = useState<Record<number, string>>({});
  const [activeTab, setActiveTab] = useState<StatusTab>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 신청/수정 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [editTrip, setEditTrip] = useState<Trip | null>(null);
  const [form, setForm] = useState<TripFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // 반려 모달
  const [rejectTrip, setRejectTrip] = useState<Trip | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSaving, setRejectSaving] = useState(false);
  const [rejectError, setRejectError] = useState('');

  // 완료 보고 모달
  const [completeTrip, setCompleteTrip] = useState<Trip | null>(null);
  const [reportText, setReportText] = useState('');
  const [completeSaving, setCompleteSaving] = useState(false);
  const [completeError, setCompleteError] = useState('');

  // 보고 보기 모달 (읽기 전용)
  const [viewTrip, setViewTrip] = useState<Trip | null>(null);

  const isManager = isLeaderOrAbove(user);

  useEffect(() => {
    setUser(getUser());
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (activeTab) params.set('status', activeTab);
      const qs = params.toString();
      const data = await api.get<Trip[]>(`/api/trips${qs ? `?${qs}` : ''}`);
      setTrips(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`오류 — ${err.message}`);
      } else {
        setError('네트워크 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 관리자: 신청자 이름 표시용 직원 목록
  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    api
      .get<Employee[]>('/api/employees')
      .then((list) => {
        if (cancelled) return;
        const map: Record<number, string> = {};
        for (const e of list) map[e.id] = e.name;
        setEmployees(map);
      })
      .catch(() => {
        // 이름 조회 실패 시 user_id로 대체 표시
      });
    return () => {
      cancelled = true;
    };
  }, [isManager]);

  function openCreateModal() {
    setEditTrip(null);
    setForm({ ...DEFAULT_FORM, start_date: todayIso(), end_date: todayIso() });
    setSaveError('');
    setModalOpen(true);
  }

  function openEditModal(trip: Trip) {
    setEditTrip(trip);
    setForm({
      destination: trip.destination,
      purpose: trip.purpose,
      start_date: trip.start_date,
      end_date: trip.end_date,
      note: trip.note ?? '',
    });
    setSaveError('');
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (form.end_date < form.start_date) {
      setSaveError('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        destination: form.destination,
        purpose: form.purpose,
        start_date: form.start_date,
        end_date: form.end_date,
        note: form.note || null,
      };
      if (editTrip) {
        await api.patch(`/api/trips/${editTrip.id}`, payload);
      } else {
        await api.post('/api/trips', payload);
      }
      setModalOpen(false);
      fetchData();
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(`저장 실패: ${err.message}`);
      } else {
        setSaveError('저장 중 오류가 발생했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(trip: Trip) {
    if (!confirm(`"${trip.destination}" 출장 신청을 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/trips/${trip.id}`);
      fetchData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '삭제 중 오류가 발생했습니다.');
    }
  }

  async function handleCancel(trip: Trip) {
    if (!confirm(`"${trip.destination}" 출장을 취소하시겠습니까?`)) return;
    try {
      await api.patch(`/api/trips/${trip.id}`, { status: 'cancelled' });
      fetchData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '취소 중 오류가 발생했습니다.');
    }
  }

  async function handleApprove(trip: Trip) {
    if (!confirm(`"${trip.destination}" 출장을 승인하시겠습니까?`)) return;
    try {
      await api.patch(`/api/trips/${trip.id}`, { status: 'approved' });
      fetchData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '승인 중 오류가 발생했습니다.');
    }
  }

  function openRejectModal(trip: Trip) {
    setRejectTrip(trip);
    setRejectReason('');
    setRejectError('');
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectTrip) return;
    setRejectSaving(true);
    setRejectError('');
    try {
      await api.patch(`/api/trips/${rejectTrip.id}`, {
        status: 'rejected',
        reject_reason: rejectReason || null,
      });
      setRejectTrip(null);
      fetchData();
    } catch (err) {
      if (err instanceof ApiError) {
        setRejectError(`반려 실패: ${err.message}`);
      } else {
        setRejectError('반려 처리 중 오류가 발생했습니다.');
      }
    } finally {
      setRejectSaving(false);
    }
  }

  function openCompleteModal(trip: Trip) {
    setCompleteTrip(trip);
    setReportText('');
    setCompleteError('');
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    if (!completeTrip) return;
    if (!reportText.trim()) {
      setCompleteError('결과 보고 내용을 입력하세요.');
      return;
    }
    setCompleteSaving(true);
    setCompleteError('');
    try {
      await api.patch(`/api/trips/${completeTrip.id}`, {
        status: 'completed',
        report: reportText.trim(),
      });
      setCompleteTrip(null);
      fetchData();
    } catch (err) {
      if (err instanceof ApiError) {
        setCompleteError(`보고 실패: ${err.message}`);
      } else {
        setCompleteError('완료 보고 중 오류가 발생했습니다.');
      }
    } finally {
      setCompleteSaving(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">출장관리</h1>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          + 출장 신청
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.value
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
          <button onClick={fetchData} className="ml-2 underline text-red-600">
            재시도
          </button>
        </div>
      )}

      {/* Trip table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            데이터를 불러오는 중...
          </div>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <span className="text-5xl">🧳</span>
            <p className="text-sm">등록된 출장이 없습니다.</p>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 transition-colors"
            >
              출장 신청하기
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">출장지</th>
                  <th className="px-4 py-3 font-medium">목적</th>
                  <th className="px-4 py-3 font-medium">기간</th>
                  <th className="px-4 py-3 font-medium">상태</th>
                  {isManager && <th className="px-4 py-3 font-medium">신청자</th>}
                  <th className="px-4 py-3 font-medium">처리 정보</th>
                  <th className="px-4 py-3 font-medium text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => {
                  const statusInfo = STATUS_LABELS[trip.status] ?? {
                    label: trip.status,
                    color: 'bg-gray-100 text-gray-600',
                  };
                  const isOwn = user != null && trip.user_id === user.id;
                  return (
                    <tr
                      key={trip.id}
                      className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-800">{trip.destination}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[16rem]">
                        <span className="block truncate" title={trip.purpose}>
                          {trip.purpose}
                        </span>
                        {trip.note && (
                          <span
                            className="block truncate text-xs text-gray-400"
                            title={trip.note}
                          >
                            비고: {trip.note}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {trip.start_date} ~ {trip.end_date}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      {isManager && (
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {employees[trip.user_id] ?? `#${trip.user_id}`}
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {(trip.status === 'approved' ||
                          trip.status === 'rejected' ||
                          trip.status === 'completed') && (
                          <span className="block whitespace-nowrap">
                            처리일 {formatDateTime(trip.decided_at)}
                          </span>
                        )}
                        {trip.status === 'rejected' && trip.reject_reason && (
                          <span
                            className="block truncate max-w-[12rem] text-red-500"
                            title={trip.reject_reason}
                          >
                            사유: {trip.reject_reason}
                          </span>
                        )}
                        {trip.status !== 'approved' &&
                          trip.status !== 'rejected' &&
                          trip.status !== 'completed' && <span>—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {isOwn && trip.status === 'requested' && (
                            <>
                              <button
                                onClick={() => openEditModal(trip)}
                                className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-500 hover:bg-gray-50"
                              >
                                수정
                              </button>
                              <button
                                onClick={() => handleDelete(trip)}
                                className="text-xs px-2 py-1 border border-red-200 rounded text-red-500 hover:bg-red-50"
                              >
                                삭제
                              </button>
                            </>
                          )}
                          {isOwn &&
                            (trip.status === 'requested' || trip.status === 'approved') && (
                              <button
                                onClick={() => handleCancel(trip)}
                                className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-500 hover:bg-gray-50"
                              >
                                취소
                              </button>
                            )}
                          {isOwn && trip.status === 'approved' && (
                            <button
                              onClick={() => openCompleteModal(trip)}
                              className="text-xs px-2 py-1 border border-blue-300 rounded text-blue-600 hover:bg-blue-50"
                            >
                              완료 보고
                            </button>
                          )}
                          {isManager && trip.status === 'requested' && (
                            <>
                              <button
                                onClick={() => handleApprove(trip)}
                                className="text-xs px-2 py-1 border border-green-300 rounded text-green-600 hover:bg-green-50"
                              >
                                승인
                              </button>
                              <button
                                onClick={() => openRejectModal(trip)}
                                className="text-xs px-2 py-1 border border-red-200 rounded text-red-500 hover:bg-red-50"
                              >
                                반려
                              </button>
                            </>
                          )}
                          {trip.status === 'completed' && (
                            <button
                              onClick={() => setViewTrip(trip)}
                              className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-500 hover:bg-gray-50"
                            >
                              보고 보기
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 신청/수정 모달 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">
                {editTrip ? '출장 수정' : '출장 신청'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  출장지 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.destination}
                  onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="출장지를 입력하세요"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  목적 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.purpose}
                  onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="출장 목적을 입력하세요"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    시작일 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    required
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    종료일 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    required
                    min={form.start_date || undefined}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비고</label>
                <textarea
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="추가로 남길 내용 (선택)"
                />
              </div>

              {saveError && <p className="text-sm text-red-600">✗ {saveError}</p>}

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : editTrip ? '저장' : '신청'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 반려 모달 */}
      {rejectTrip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">출장 반려</h2>
              <button
                onClick={() => setRejectTrip(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleReject} className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-600">
                <span className="font-medium text-gray-800">{rejectTrip.destination}</span> (
                {rejectTrip.start_date} ~ {rejectTrip.end_date}) 출장 신청을 반려합니다.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">반려 사유</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="반려 사유를 입력하세요 (선택)"
                />
              </div>

              {rejectError && <p className="text-sm text-red-600">✗ {rejectError}</p>}

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setRejectTrip(null)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={rejectSaving}
                  className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  {rejectSaving ? '처리 중...' : '반려'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 완료 보고 모달 */}
      {completeTrip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">출장 완료 보고</h2>
              <button
                onClick={() => setCompleteTrip(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleComplete} className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-600">
                <span className="font-medium text-gray-800">{completeTrip.destination}</span> (
                {completeTrip.start_date} ~ {completeTrip.end_date}) 출장 결과를 보고합니다.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  결과 보고 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reportText}
                  onChange={(e) => setReportText(e.target.value)}
                  rows={5}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="출장 결과를 입력하세요"
                />
              </div>

              {completeError && <p className="text-sm text-red-600">✗ {completeError}</p>}

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setCompleteTrip(null)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={completeSaving}
                  className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {completeSaving ? '제출 중...' : '완료 보고'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 보고 보기 모달 (읽기 전용) */}
      {viewTrip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">출장 결과 보고</h2>
              <button
                onClick={() => setViewTrip(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <div className="text-sm text-gray-600 space-y-1">
                <p>
                  <span className="text-gray-400 mr-2">출장지</span>
                  <span className="font-medium text-gray-800">{viewTrip.destination}</span>
                </p>
                <p>
                  <span className="text-gray-400 mr-2">목적</span>
                  {viewTrip.purpose}
                </p>
                <p>
                  <span className="text-gray-400 mr-2">기간</span>
                  {viewTrip.start_date} ~ {viewTrip.end_date}
                </p>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-700 mb-1">결과 보고</div>
                <div className="border border-gray-200 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
                  {viewTrip.report || '보고 내용이 없습니다.'}
                </div>
              </div>

              <div className="flex pt-2 border-t border-gray-100">
                <button
                  onClick={() => setViewTrip(null)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
