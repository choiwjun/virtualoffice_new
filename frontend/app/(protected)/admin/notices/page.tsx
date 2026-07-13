'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';

// 공지사항 관리 (14-virtual-office-spec §2.8, 04-data-model §2.7). 작성/수정/삭제=admin.
interface Notice {
  id: string;
  title: string;
  body: string | null;
  author: string;
  category: string;
  pinned: boolean;
  published_at: string;
  expires_at: string | null;
  created_at: string;
}

interface NoticeListResponse {
  items: Notice[];
  total: number;
}

// 분류 표시 메타 (04-data-model §2.7: system | notice | info)
const CATEGORY_META: Record<string, { label: string; cls: string }> = {
  system: { label: '시스템', cls: 'bg-red-100 text-red-700' },
  notice: { label: '공지', cls: 'bg-indigo-100 text-indigo-700' },
  info: { label: '안내', cls: 'bg-gray-100 text-gray-600' },
};

function CategoryBadge({ category }: { category: string }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.notice;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
  );
}

// 알려진 백엔드 오류 코드 → 한글 안내
const KNOWN_ERRORS: Record<string, string> = {
  expires_at_before_published_at: '만료 시각이 게시 시각보다 빠릅니다.',
  notice_not_found: '공지를 찾을 수 없습니다.',
};

// ApiError.message 노출 (QA #7) — 페이지 전용 코드는 KNOWN_ERRORS로 보강
function errMsg(err: unknown, prefix: string): string {
  if (err instanceof ApiError) {
    const known = err.code ? KNOWN_ERRORS[err.code] : undefined;
    return `${prefix} (${err.status}): ${known ?? err.message}`;
  }
  return '서버 연결 오류';
}

// ISO(UTC) → datetime-local 입력값(로컬시각)
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [category, setCategory] = useState('notice');
  const [pinned, setPinned] = useState(false);
  const [publishedAt, setPublishedAt] = useState(''); // datetime-local — 비우면 즉시, 미래=예약 게시
  const [expiresAt, setExpiresAt] = useState(''); // datetime-local (로컬시각) — 비우면 만료 없음
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // 수정 모달
  const [editTarget, setEditTarget] = useState<Notice | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editCategory, setEditCategory] = useState('notice');
  const [editPinned, setEditPinned] = useState(false);
  const [editPublishedAt, setEditPublishedAt] = useState('');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const fetchNotices = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.get<NoticeListResponse>('/api/notices?limit=100');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(errMsg(err, '조회 실패'));
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
          category,
          pinned,
          // datetime-local(로컬) → ISO(UTC 포함) 변환. 비우면 즉시 게시 / 미래 시각=예약 게시.
          published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        });
        setTitle('');
        setAuthor('');
        setBody('');
        setCategory('notice');
        setPinned(false);
        setPublishedAt('');
        setExpiresAt('');
        await fetchNotices();
      } catch (err) {
        setFormError(errMsg(err, '등록 실패'));
      } finally {
        setSubmitting(false);
      }
    },
    [title, author, body, category, pinned, publishedAt, expiresAt, fetchNotices],
  );

  const openEdit = useCallback((n: Notice) => {
    setEditTarget(n);
    setEditTitle(n.title);
    setEditBody(n.body ?? '');
    setEditCategory(n.category);
    setEditPinned(n.pinned);
    setEditPublishedAt(toLocalInput(n.published_at));
    setEditExpiresAt(toLocalInput(n.expires_at));
    setEditError('');
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!editTarget) return;
    if (!editTitle.trim()) {
      setEditError('제목을 입력하세요.');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await api.patch(`/api/notices/${editTarget.id}`, {
        title: editTitle.trim(),
        body: editBody.trim() || null,
        category: editCategory,
        pinned: editPinned,
        // 게시시각은 비우면 변경하지 않음(필수 컬럼) / 미래 시각=예약 게시
        ...(editPublishedAt ? { published_at: new Date(editPublishedAt).toISOString() } : {}),
        // 만료는 비우면 "만료 없음"으로 해제
        expires_at: editExpiresAt ? new Date(editExpiresAt).toISOString() : null,
      });
      setEditTarget(null);
      await fetchNotices();
    } catch (err) {
      setEditError(errMsg(err, '수정 실패'));
    } finally {
      setEditSaving(false);
    }
  }, [editTarget, editTitle, editBody, editCategory, editPinned, editPublishedAt, editExpiresAt, fetchNotices]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('이 공지를 삭제할까요?')) return;
      try {
        await api.delete(`/api/notices/${id}`);
        await fetchNotices();
      } catch (err) {
        alert(errMsg(err, '삭제 실패'));
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
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-28 border border-gray-300 rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="notice">공지</option>
            <option value="system">시스템</option>
            <option value="info">안내</option>
          </select>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              상단 고정
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600" title="비우면 즉시 게시, 미래 시각을 지정하면 예약 게시됩니다.">
              게시
              <input
                type="datetime-local"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-[10px] text-gray-400">비우면 즉시 · 미래=예약</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              만료
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
          </div>
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
                <th className="text-left px-4 py-2.5 font-medium w-16">분류</th>
                <th className="text-left px-4 py-2.5 font-medium">제목</th>
                <th className="text-left px-4 py-2.5 font-medium w-28">작성자</th>
                <th className="text-left px-4 py-2.5 font-medium w-40">게시 (KST)</th>
                <th className="text-right px-4 py-2.5 font-medium w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((n) => (
                <tr key={n.id}>
                  <td className="px-4 py-2">
                    {n.pinned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">고정</span>}
                  </td>
                  <td className="px-4 py-2"><CategoryBadge category={n.category} /></td>
                  <td className="px-4 py-2 text-gray-700">{n.title}</td>
                  <td className="px-4 py-2 text-gray-500">{n.author}</td>
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{formatKst(n.published_at ?? n.created_at)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(n)} className="text-xs text-indigo-600 hover:underline mr-3">수정</button>
                    <button onClick={() => handleDelete(n.id)} className="text-xs text-red-600 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 수정 모달 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">공지 수정</h2>
              <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={255}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">본문</label>
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex flex-col text-xs text-gray-500 gap-1">
                  분류
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="notice">공지</option>
                    <option value="system">시스템</option>
                    <option value="info">안내</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 mt-4">
                  <input type="checkbox" checked={editPinned} onChange={(e) => setEditPinned(e.target.checked)} />
                  상단 고정
                </label>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col text-xs text-gray-500 gap-1">
                  게시시각 (미래=예약 게시)
                  <input
                    type="datetime-local"
                    value={editPublishedAt}
                    onChange={(e) => setEditPublishedAt(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                <label className="flex flex-col text-xs text-gray-500 gap-1">
                  만료시각 (비우면 만료 없음)
                  <input
                    type="datetime-local"
                    value={editExpiresAt}
                    onChange={(e) => setEditExpiresAt(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
              </div>
              {editError && <p className="text-sm text-red-600">{editError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setEditTarget(null)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={handleUpdate}
                  disabled={editSaving || !editTitle.trim()}
                  className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {editSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
