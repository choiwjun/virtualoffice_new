'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';

// 공지사항 관리 (14-virtual-office-spec §2.8). 작성/삭제=admin. 목록은 대시보드 우측 패널과 동일 소스.
interface Notice {
  id: string;
  title: string;
  body: string | null;
  author: string;
  pinned: boolean;
  created_at: string;
}

interface NoticeListResponse {
  items: Notice[];
  total: number;
}

export default function AdminNoticesPage() {
  const me = getUser();
  const allowed = isAdmin(me);

  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 작성 폼
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchNotices = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.get<NoticeListResponse>('/api/notices?limit=100');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof ApiError ? `조회 실패 (${err.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    fetchNotices();
  }, [fetchNotices]);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) {
        setFormError('제목을 입력하세요.');
        return;
      }
      setSubmitting(true);
      setFormError('');
      try {
        await api.post('/api/notices', {
          title: title.trim(),
          author: author.trim() || '공지',
          body: body.trim() || null,
          pinned,
        });
        setTitle('');
        setAuthor('');
        setBody('');
        setPinned(false);
        await fetchNotices();
      } catch (err) {
        setFormError(err instanceof ApiError ? `등록 실패 (${err.status})` : '서버 연결 오류');
      } finally {
        setSubmitting(false);
      }
    },
    [title, author, body, pinned, fetchNotices],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('이 공지를 삭제할까요?')) return;
      try {
        await api.delete(`/api/notices/${id}`);
        await fetchNotices();
      } catch (err) {
        alert(err instanceof ApiError ? `삭제 실패 (${err.status})` : '서버 연결 오류');
      }
    },
    [fetchNotices],
  );

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto mt-20 text-center bg-white border border-gray-200 rounded-xl p-8">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-gray-700 font-medium">관리자 전용 화면</p>
          <p className="text-sm text-gray-400 mt-1">공지 관리는 관리자만 접근할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1">공지사항 관리</h1>
      <p className="text-xs text-gray-400 mb-4">대시보드 우측 공지 패널에 노출됩니다 · 14-spec §2.8</p>

      {/* 작성 폼 */}
      <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-4 mb-6 space-y-3">
        <div className="flex flex-wrap gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="공지 제목"
            maxLength={255}
            className="flex-1 min-w-[240px] border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="작성자 (예: 인사팀)"
            maxLength={100}
            className="w-44 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="본문 (선택)"
          rows={2}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            상단 고정
          </label>
          <div className="flex items-center gap-3">
            {formError && <span className="text-xs text-red-600">{formError}</span>}
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? '등록 중...' : '공지 등록'}
            </button>
          </div>
        </div>
      </form>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-red-600 text-sm mb-2">{error}</p>
          <button onClick={fetchNotices} className="text-xs text-indigo-600 underline">재시도</button>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">등록된 공지가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium w-8"></th>
                <th className="text-left px-4 py-2.5 font-medium">제목</th>
                <th className="text-left px-4 py-2.5 font-medium w-28">작성자</th>
                <th className="text-left px-4 py-2.5 font-medium w-40">등록 (KST)</th>
                <th className="text-right px-4 py-2.5 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((n) => (
                <tr key={n.id}>
                  <td className="px-4 py-2">
                    {n.pinned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">고정</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-700">{n.title}</td>
                  <td className="px-4 py-2 text-gray-500">{n.author}</td>
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{formatKst(n.created_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDelete(n.id)} className="text-xs text-red-600 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
