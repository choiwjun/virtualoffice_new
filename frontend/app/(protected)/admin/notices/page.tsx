'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';
import {
  PageHeader,
  ToolbarButton,
  SectionCard,
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '@/components/ui/console';
import { useToast, useConfirm } from '@/components/ui/feedback';

const ICON = {
  megaphone: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 8v4l9 4V4z" /><path d="M4 8H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1" /><path d="M16 8a3 3 0 0 1 0 4" /></svg>,
  refresh: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M15.5 6.5A6 6 0 1 0 16 10" /><path d="M15.5 3v4h-4" /></svg>,
  edit: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M13 4l3 3-8.5 8.5H4.5v-3z" /><path d="M11.5 5.5l3 3" /></svg>,
  list: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 6h12M4 10h12M4 14h8" /></svg>,
  lock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="4" y="9" width="12" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>,
};

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
  system: { label: '시스템', cls: 'bg-[rgba(239,68,68,0.12)] text-red-300' },
  notice: { label: '공지', cls: 'bg-[rgba(59,91,254,0.2)] text-[#93A9FF]' },
  info: { label: '안내', cls: 'bg-bg-surface text-text-secondary' },
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
  const toast = useToast();
  const confirm = useConfirm();

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
        toast.success('공지가 등록되었습니다.');
      } catch (err) {
        setFormError(errMsg(err, '등록 실패'));
      } finally {
        setSubmitting(false);
      }
    },
    [title, author, body, category, pinned, publishedAt, expiresAt, fetchNotices, toast],
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
      toast.success('공지가 수정되었습니다.');
    } catch (err) {
      setEditError(errMsg(err, '수정 실패'));
    } finally {
      setEditSaving(false);
    }
  }, [editTarget, editTitle, editBody, editCategory, editPinned, editPublishedAt, editExpiresAt, fetchNotices, toast]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!(await confirm({ message: '이 공지를 삭제할까요?', danger: true }))) return;
      try {
        await api.delete(`/api/notices/${id}`);
        await fetchNotices();
        toast.success('공지가 삭제되었습니다.');
      } catch (err) {
        toast.error(errMsg(err, '삭제 실패'));
      }
    },
    [fetchNotices, confirm, toast],
  );

  if (!allowed) {
    return (
      <div className="p-6 text-text-secondary">
        <div className="max-w-md mx-auto mt-20">
          <SectionCard>
            <EmptyState icon={ICON.lock} title="관리자 전용 화면" hint="공지 관리는 관리자만 접근할 수 있습니다." />
          </SectionCard>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="공지사항 관리"
        subtitle="대시보드 우측 공지 패널에 노출됩니다 · 14-spec §2.8"
        icon={ICON.megaphone}
        actions={
          <ToolbarButton onClick={fetchNotices} disabled={loading} icon={ICON.refresh}>
            새로고침
          </ToolbarButton>
        }
      />

      <div className="flex-1 overflow-y-auto flex flex-col gap-5 pr-0.5">
        {/* 작성 폼 */}
        <SectionCard title="공지 작성" icon={ICON.edit}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="공지 제목"
                maxLength={255}
                className="flex-1 min-w-[240px] border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-28 border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
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
                className="w-44 border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
              />
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="본문 (선택)"
              rows={2}
              className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                  상단 고정
                </label>
                <label className="flex items-center gap-2 text-sm text-text-secondary" title="비우면 즉시 게시, 미래 시각을 지정하면 예약 게시됩니다.">
                  게시
                  <input
                    type="datetime-local"
                    value={publishedAt}
                    onChange={(e) => setPublishedAt(e.target.value)}
                    className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]"
                  />
                  <span className="text-[10px] text-text-muted">비우면 즉시 · 미래=예약</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  만료
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                {formError && <span className="text-xs text-red-300">{formError}</span>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50"
                >
                  {submitting ? '등록 중...' : '공지 등록'}
                </button>
              </div>
            </div>
          </form>
        </SectionCard>

        {/* 목록 */}
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorBanner message={error} onRetry={fetchNotices} />
        ) : (
          <SectionCard title="공지 목록" icon={ICON.list} bodyClassName="p-0">
            {items.length === 0 ? (
              <EmptyState icon={ICON.megaphone} title="등록된 공지가 없습니다." hint="위 폼에서 새 공지를 등록하세요." compact />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-bg-base text-text-muted text-xs">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium w-8"></th>
                    <th className="text-left px-4 py-2.5 font-medium w-16">분류</th>
                    <th className="text-left px-4 py-2.5 font-medium">제목</th>
                    <th className="text-left px-4 py-2.5 font-medium w-28">작성자</th>
                    <th className="text-left px-4 py-2.5 font-medium w-40">게시 (KST)</th>
                    <th className="text-right px-4 py-2.5 font-medium w-28"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {items.map((n) => (
                    <tr key={n.id}>
                      <td className="px-4 py-2">
                        {n.pinned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(245,158,11,0.16)] text-status-external">고정</span>}
                      </td>
                      <td className="px-4 py-2"><CategoryBadge category={n.category} /></td>
                      <td className="px-4 py-2 text-text-secondary">{n.title}</td>
                      <td className="px-4 py-2 text-text-muted">{n.author}</td>
                      <td className="px-4 py-2 text-text-muted whitespace-nowrap">{formatKst(n.published_at ?? n.created_at)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(n)} className="text-xs text-accent-cyan hover:underline mr-3">수정</button>
                        <button onClick={() => handleDelete(n.id)} className="text-xs text-red-300 hover:underline">삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        )}
      </div>

      {/* 수정 모달 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div role="dialog" aria-modal="true" aria-label="공지 수정" className="rounded-2xl shadow-2xl w-full max-w-lg border border-border-subtle" style={{ background: 'rgb(var(--color-bg-surface))' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <h2 className="font-semibold text-text-primary">공지 수정</h2>
              <button onClick={() => setEditTarget(null)} aria-label="닫기" className="text-text-muted hover:text-text-primary text-xl">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">제목</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={255}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">본문</label>
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={3}
                  className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex flex-col text-xs text-text-muted gap-1">
                  분류
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="border border-border-subtle bg-bg-base rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-cyan"
                  >
                    <option value="notice">공지</option>
                    <option value="system">시스템</option>
                    <option value="info">안내</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-text-secondary mt-4">
                  <input type="checkbox" checked={editPinned} onChange={(e) => setEditPinned(e.target.checked)} />
                  상단 고정
                </label>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col text-xs text-text-muted gap-1">
                  게시시각 (미래=예약 게시)
                  <input
                    type="datetime-local"
                    value={editPublishedAt}
                    onChange={(e) => setEditPublishedAt(e.target.value)}
                    className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]"
                  />
                </label>
                <label className="flex flex-col text-xs text-text-muted gap-1">
                  만료시각 (비우면 만료 없음)
                  <input
                    type="datetime-local"
                    value={editExpiresAt}
                    onChange={(e) => setEditExpiresAt(e.target.value)}
                    className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]"
                  />
                </label>
              </div>
              {editError && <p className="text-sm text-red-300">{editError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setEditTarget(null)}
                  className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised"
                >
                  취소
                </button>
                <button
                  onClick={handleUpdate}
                  disabled={editSaving || !editTitle.trim()}
                  className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50"
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
