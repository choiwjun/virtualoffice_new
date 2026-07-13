'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, type User } from '@/lib/auth';

interface Channel {
  id: string;
  label: string;
}

interface ChatMessage {
  id: string;
  channel: string;
  user_id: number;
  user_name: string;
  content: string;
  created_at: string;
}

const MAX_LENGTH = 2000;
const POLL_INTERVAL_MS = 4000;
const NEAR_BOTTOM_PX = 80;
const TEXTAREA_MAX_HEIGHT_PX = 96; // 약 4줄

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR');
}

export default function ChatPage() {
  const [me, setMe] = useState<User | null>(null);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsError, setChannelsError] = useState('');
  const [activeChannel, setActiveChannel] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const messagesRef = useRef<ChatMessage[]>([]);
  const activeChannelRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const initialScrollRef = useRef(true);
  const pollInFlightRef = useRef(false);

  messagesRef.current = messages;
  activeChannelRef.current = activeChannel;

  useEffect(() => {
    setMe(getUser());
  }, []);

  // 채널 목록 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.get<Channel[]>('/api/chat/channels');
        if (cancelled) return;
        setChannels(list);
        setActiveChannel((prev) => prev ?? list[0]?.id ?? null);
      } catch (err) {
        if (cancelled) return;
        setChannelsError(
          err instanceof ApiError
            ? `채널 목록을 불러오지 못했습니다. (${err.status})`
            : '네트워크 오류가 발생했습니다.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 채널 메시지 전체 로드 (초기 진입·채널 전환·새로고침)
  const loadMessages = useCallback(async (channelId: string) => {
    setLoading(true);
    setError('');
    try {
      const list = await api.get<ChatMessage[]>(
        `/api/chat/messages?channel=${encodeURIComponent(channelId)}&limit=50`,
      );
      if (activeChannelRef.current !== channelId) return; // 전환 중 도착한 응답 무시
      setMessages(list);
      stickToBottomRef.current = true;
      initialScrollRef.current = true;
    } catch (err) {
      if (activeChannelRef.current !== channelId) return;
      setError(
        err instanceof ApiError
          ? `메시지를 불러오지 못했습니다. (${err.status})`
          : '네트워크 오류가 발생했습니다.',
      );
    } finally {
      if (activeChannelRef.current === channelId) setLoading(false);
    }
  }, []);

  // 채널 전환 시 새로 로드
  useEffect(() => {
    if (!activeChannel) return;
    setMessages([]);
    setSendError('');
    loadMessages(activeChannel);
  }, [activeChannel, loadMessages]);

  // 증분 폴링 (4초, hidden 시 스킵, id 중복 제거)
  useEffect(() => {
    if (!activeChannel) return;
    const timer = setInterval(async () => {
      if (document.hidden || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const last = messagesRef.current[messagesRef.current.length - 1];
        const params = new URLSearchParams({ channel: activeChannel, limit: '50' });
        if (last) params.set('after', last.created_at);
        const incoming = await api.get<ChatMessage[]>(`/api/chat/messages?${params}`);
        if (activeChannelRef.current !== activeChannel || incoming.length === 0) return;
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = incoming.filter((m) => !seen.has(m.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      } catch {
        // 폴링 실패는 조용히 무시하고 다음 주기에 재시도
      } finally {
        pollInFlightRef.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeChannel]);

  // 하단 근접 여부 판정 (위로 스크롤해 읽는 중이면 강제 스크롤 금지)
  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  // 새 메시지 도착·전송 시 자동 스크롤
  useEffect(() => {
    if (messages.length === 0) return;
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: initialScrollRef.current ? 'auto' : 'smooth',
      block: 'end',
    });
    initialScrollRef.current = false;
  }, [messages]);

  // textarea 자동 확장 (최대 4줄)
  function autoResize() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }

  const canSend =
    !sending && input.trim().length > 0 && input.length <= MAX_LENGTH && !!activeChannel;

  async function handleSend() {
    if (!canSend || !activeChannel) return;
    const content = input.trim();
    setSending(true);
    setSendError('');
    try {
      const created = await api.post<ChatMessage>('/api/chat/messages', {
        channel: activeChannel,
        content,
      });
      setInput('');
      const ta = textareaRef.current;
      if (ta) ta.style.height = 'auto';
      stickToBottomRef.current = true;
      if (activeChannelRef.current === activeChannel) {
        setMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created],
        );
      }
      textareaRef.current?.focus();
    } catch (err) {
      setSendError(
        err instanceof ApiError
          ? `전송 실패 (${err.status})`
          : '전송 중 오류가 발생했습니다.',
      );
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing) return; // 한글 IME 조합 중 전송 방지
      e.preventDefault();
      handleSend();
    }
  }

  const activeLabel = channels.find((c) => c.id === activeChannel)?.label ?? '';

  return (
    <div className="h-full flex">
      {/* 좌측 채널 사이드바 */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-base font-bold text-gray-800">커뮤니케이션</h1>
          <p className="text-xs text-gray-400 mt-0.5">채널 채팅</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {channelsError ? (
            <p className="px-2 py-2 text-xs text-red-600">{channelsError}</p>
          ) : channels.length === 0 ? (
            <p className="px-2 py-2 text-xs text-gray-400">채널을 불러오는 중...</p>
          ) : (
            channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => setActiveChannel(ch.id)}
                className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                  activeChannel === ch.id
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <span className="text-gray-400 mr-1.5">#</span>
                {ch.label}
              </button>
            ))
          )}
        </nav>
      </aside>

      {/* 우측 메시지 영역 */}
      <section className="flex-1 min-w-0 flex flex-col">
        {/* 상단 바 */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800 truncate">
            {activeChannel ? (
              <>
                <span className="text-gray-400 mr-1">#</span>
                {activeLabel}
              </>
            ) : (
              '채널을 선택하세요'
            )}
          </h2>
          <button
            onClick={() => activeChannel && loadMessages(activeChannel)}
            disabled={loading || !activeChannel}
            title="새로고침"
            className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            🔄
          </button>
        </div>

        {/* 메시지 리스트 */}
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="flex-1 overflow-y-auto p-4 bg-gray-100"
        >
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
              <button
                onClick={() => activeChannel && loadMessages(activeChannel)}
                className="ml-2 underline text-red-600"
              >
                재시도
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
              메시지를 불러오는 중...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
              <span className="text-5xl">💬</span>
              <p className="text-sm">아직 메시지가 없습니다. 첫 메시지를 보내보세요!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, i) => {
                const isMine = me != null && msg.user_id === me.id;
                const date = formatDate(msg.created_at);
                const showDateDivider =
                  i === 0 || date !== formatDate(messages[i - 1].created_at);
                return (
                  <div key={msg.id}>
                    {showDateDivider && (
                      <div className="flex items-center justify-center my-4">
                        <span className="text-xs text-gray-400 bg-gray-100 px-3">
                          — {date} —
                        </span>
                      </div>
                    )}
                    {isMine ? (
                      <div className="flex justify-end items-end gap-1.5">
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {formatTime(msg.created_at)}
                        </span>
                        <div className="max-w-[70%] px-3.5 py-2 text-sm bg-indigo-600 text-white rounded-2xl rounded-br-sm whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start">
                        <span className="text-xs text-gray-500 mb-0.5 ml-1">
                          {msg.user_name}
                        </span>
                        <div className="flex items-end gap-1.5 max-w-full">
                          <div className="max-w-[70%] px-3.5 py-2 text-sm bg-white border border-gray-200 text-gray-800 rounded-2xl rounded-bl-sm whitespace-pre-wrap break-words">
                            {msg.content}
                          </div>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* 하단 입력창 */}
        <div className="bg-white border-t border-gray-200 p-3">
          {sendError && <p className="text-xs text-red-600 mb-2">✗ {sendError}</p>}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoResize();
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={sending || !activeChannel}
              placeholder={
                activeChannel
                  ? '메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)'
                  : '채널을 선택하세요'
              }
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm resize-none overflow-y-auto focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
              style={{ maxHeight: TEXTAREA_MAX_HEIGHT_PX }}
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="flex-shrink-0 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {sending ? '전송 중...' : '전송'}
            </button>
          </div>
          <div className="flex justify-end mt-1">
            <span
              className={`text-xs ${
                input.length > MAX_LENGTH ? 'text-red-500 font-medium' : 'text-gray-400'
              }`}
            >
              {input.length}/{MAX_LENGTH}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
