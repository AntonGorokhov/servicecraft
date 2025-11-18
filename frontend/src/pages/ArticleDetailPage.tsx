import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../constants/categories";
import type { ArticleDetail, Comment } from "../constants/mockData";
import client from "../api/client";
import { useAuth } from "../hooks/useAuth";

function Section({
  title,
  icon,
  count,
  defaultOpen,
  accent,
  children,
}: {
  title: string;
  icon: string;
  count?: number;
  defaultOpen?: boolean;
  accent?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div
      className={`rounded-xl border bg-white transition-shadow ${open ? "shadow-sm" : ""}`}
      style={{ borderLeftWidth: 3, borderLeftColor: accent ?? "#e5e7eb" }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className="text-xl">{icon}</span>
        <span className="flex-1 text-base font-semibold text-gray-900">
          {title}
        </span>
        {count !== undefined && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            {count}
          </span>
        )}
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="border-t px-6 pb-6 pt-5">{children}</div>}
    </div>
  );
}

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function relativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч. назад`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} дн. назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [viewMode, setViewMode] = useState<"operator" | "agent">(() =>
    (localStorage.getItem("articleViewMode") as "operator" | "agent") ?? "agent"
  );

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === "agent" ? "operator" : "agent";
      localStorage.setItem("articleViewMode", next);
      return next;
    });
  }, []);

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [quotedText, setQuotedText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);

  // Text selection floating button
  const [floatingBtn, setFloatingBtn] = useState<{ x: number; y: number; text: string } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const commentFormRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!id) return;
    client
      .get(`/articles/${id}`)
      .then((res) => setArticle(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    client
      .get(`/articles/${id}/comments`)
      .then((res) => setComments(res.data))
      .catch(() => {});
  }, [id]);

  // Handle text selection in article area
  const handleMouseUp = useCallback(() => {
    // Small delay so selection is finalized
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (text.length > 2 && articleRef.current?.contains(sel?.anchorNode ?? null)) {
        const range = sel!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setFloatingBtn({
          x: rect.left + rect.width / 2,
          y: rect.top - 8,
          text,
        });
      } else {
        setFloatingBtn(null);
      }
    }, 10);
  }, []);

  // Hide floating button on scroll
  useEffect(() => {
    const hide = () => setFloatingBtn(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, []);

  const handleStartComment = useCallback(() => {
    if (!floatingBtn) return;
    setQuotedText(floatingBtn.text);
    setShowCommentForm(true);
    setFloatingBtn(null);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => commentFormRef.current?.focus(), 100);
  }, [floatingBtn]);

  const handleAddComment = async () => {
    if (!commentBody.trim() || !id) return;
    setCommentSubmitting(true);
    try {
      const res = await client.post(`/articles/${id}/comments`, {
        quoted_text: quotedText,
        body: commentBody,
      });
      setComments((prev) => [...prev, res.data]);
      setCommentBody("");
      setQuotedText("");
      setShowCommentForm(false);
    } catch {
      // ignore
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleCancelComment = () => {
    setShowCommentForm(false);
    setCommentBody("");
    setQuotedText("");
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!id) return;
    try {
      await client.delete(`/articles/${id}/comments/${commentId}`);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-gray-400">Загрузка...</p>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="py-20 text-center">
        <p className="text-gray-400">Статья не найдена</p>
        <Link
          to="/articles"
          className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Вернуться к списку
        </Link>
      </div>
    );
  }

  const colors = CATEGORY_COLORS[article.category] ?? CATEGORY_COLORS.general;
  const label = CATEGORY_LABELS[article.category] ?? article.category;
  const content = article.content ?? {};
  const conversationFlow = (content.conversation_flow ?? []).map((entry) =>
    typeof entry === "string" ? { step: entry } : entry
  );
  const clarifyingQuestions = content.clarifying_questions ?? [];
  const exceptions = content.exceptions ?? [];
  const servicesAndPrices = content.services_and_prices ?? [];
  const redFlags = content.red_flags ?? [];
  const neverSay = content.never_say ?? [];
  const faq = content.faq ?? [];
  const triggerPhrases = content.trigger_phrases ?? [];
  const evidence = content.evidence ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      {/* Back link */}
      <Link
        to="/articles"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Все статьи
      </Link>

      {/* Two-column layout: article + comments sidebar */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Article content — main column */}
        <div className="flex-1 min-w-0" ref={articleRef} onMouseUp={handleMouseUp}>
          {/* Header */}
          <div className="mb-8">
            <div className="mb-3 flex items-center gap-3">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${colors.bg} ${colors.text}`}
              >
                {label}
              </span>
              <span className="text-xs text-gray-400">
                {article.call_count} звонков · Обновлён: {article.last_updated}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              {article.name}
            </h1>
            {/* View mode toggle */}
            <div className="mt-4 inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5">
              <button
                onClick={viewMode === "agent" ? toggleViewMode : undefined}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  viewMode === "operator"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Оператор
              </button>
              <button
                onClick={viewMode === "operator" ? toggleViewMode : undefined}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  viewMode === "agent"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                AI-агент
              </button>
            </div>
          </div>

          {/* Sections */}
          <div className="flex flex-col gap-4">
            {/* Conversation Flow */}
            {conversationFlow.length > 0 && (
              <Section
                title="Шаги диалога"
                icon="💬"
                count={conversationFlow.length}
                defaultOpen
                accent={colors.dot}
              >
                {viewMode === "operator" ? (
                  /* Operator mode — compact checklist */
                  <ol className="space-y-2">
                    {conversationFlow.map((step, i) => (
                      <li key={i} className="flex items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-gray-50">
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-base text-gray-900">{step.step}</p>
                          {step.action && (
                            <span className="mt-0.5 inline-block rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                              {step.action}
                            </span>
                          )}
                        </div>
                        {/* Small icons showing what this step contains */}
                        <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                          {step.ask && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-600" title={step.ask}>?</span>
                          )}
                          {step.say && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600" title={step.say}>!</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  /* Agent mode — full dialog script */
                  <ol className="space-y-4">
                    {conversationFlow.map((step, i) => (
                      <li key={i} className="relative pl-8">
                        <span className="absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-base font-semibold text-gray-900">{step.step}</p>
                          {step.ask && (
                            <p className="mt-1 rounded-lg bg-blue-50 px-3 py-2 text-[15px] text-blue-800">
                              <span className="font-medium">Спросить:</span> {step.ask}
                            </p>
                          )}
                          {step.say && (
                            <p className="mt-1 rounded-lg bg-emerald-50 px-3 py-2 text-[15px] text-emerald-800">
                              <span className="font-medium">Сказать:</span> {step.say}
                            </p>
                          )}
                          {step.why && (
                            <p className="mt-1 text-xs text-gray-400 italic">{step.why}</p>
                          )}
                          {step.action && (
                            <span className="mt-1 inline-block rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                              Действие: {step.action}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            )}

            {/* Clarifying Questions */}
            {clarifyingQuestions.length > 0 && (
              <Section
                title="Уточняющие вопросы"
                icon="❓"
                count={clarifyingQuestions.length}
                accent="#3b82f6"
              >
                {viewMode === "operator" ? (
                  <ul className="space-y-1.5">
                    {clarifyingQuestions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-lg px-3 py-2 hover:bg-gray-50">
                        <span className="mt-1 text-blue-400">?</span>
                        <span className="text-base text-gray-900">{q.question}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-3">
                    {clarifyingQuestions.map((q, i) => (
                      <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                        <p className="text-base font-semibold text-gray-900">{q.question}</p>
                        <p className="mt-1 text-xs text-gray-500">{q.why}</p>
                        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                          Влияние: {q.impact}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* Exceptions */}
            {exceptions.length > 0 && (
              <Section
                title="Исключения"
                icon="⚡"
                count={exceptions.length}
                accent="#f59e0b"
              >
                <div className="space-y-3">
                  {exceptions.map((ex, i) => (
                    <div key={i} className="rounded-lg border border-amber-100 bg-amber-50/50 p-4">
                      <p className="text-base font-semibold text-amber-900">{ex.condition}</p>
                      <p className="mt-1 text-base text-gray-700">{ex.action}</p>
                      <span className="mt-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                        {ex.price_impact}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Services & Prices */}
            {servicesAndPrices.length > 0 && (
              <Section
                title="Услуги и цены"
                icon="💰"
                count={servicesAndPrices.length}
                accent="#10b981"
              >
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-base">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500">
                        <th className="px-4 py-2.5">Услуга</th>
                        <th className="px-4 py-2.5">Цена</th>
                        <th className="px-4 py-2.5 hidden sm:table-cell">Условие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {servicesAndPrices.map((s, i) => (
                        <tr key={i} className={s.mandatory ? "bg-emerald-50/40" : ""}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {s.price_id ? (
                                <Link
                                  to={`/price-tree#${s.price_id}`}
                                  className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  {s.service}
                                </Link>
                              ) : (
                                <span className="font-medium text-gray-900">{s.service}</span>
                              )}
                              {s.mandatory && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                  ОБЯ3.
                                </span>
                              )}
                            </div>
                            {s.includes && (
                              <p className="mt-0.5 text-xs text-gray-400">{s.includes}</p>
                            )}
                            {s.condition && (
                              <p className="mt-0.5 text-xs text-gray-400 sm:hidden">{s.condition}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                            {s.price.toLocaleString()} {s.currency}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 hidden sm:table-cell">
                            {s.condition ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Red Flags */}
            {redFlags.length > 0 && (
              <Section
                title="Красные флаги"
                icon="🚨"
                count={redFlags.length}
                accent="#ef4444"
              >
                <div className="space-y-3">
                  {redFlags.map((rf, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border p-4 ${
                        rf.urgency === "emergency"
                          ? "border-red-200 bg-red-50"
                          : "border-orange-200 bg-orange-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            rf.urgency === "emergency"
                              ? "bg-red-200 text-red-800"
                              : "bg-orange-200 text-orange-800"
                          }`}
                        >
                          {rf.urgency}
                        </span>
                        <p className="text-base font-semibold text-gray-900">{rf.signal}</p>
                      </div>
                      <p className="mt-2 text-base text-gray-700">{rf.action}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Never Say */}
            {neverSay.length > 0 && (
              <Section
                title="Чего не говорить"
                icon="🚫"
                count={neverSay.length}
                accent="#6b7280"
              >
                <ul className="space-y-2">
                  {neverSay.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-base text-gray-700"
                    >
                      <span className="mt-0.5 text-red-400">✕</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* FAQ */}
            {faq.length > 0 && (
              <Section
                title="Частые вопросы"
                icon="📋"
                count={faq.length}
                accent="#8b5cf6"
              >
                <div className="space-y-3">
                  {faq.map((item, i) => (
                    <div key={i} className="rounded-lg border border-gray-100 p-4">
                      <p className="text-[15px] font-semibold text-gray-900">{item.q}</p>
                      <p className="mt-2 text-[15px] text-gray-600 leading-relaxed">{item.a}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Trigger Phrases */}
            {triggerPhrases.length > 0 && (
              <Section
                title="Триггерные фразы"
                icon="🎯"
                count={triggerPhrases.length}
                accent="#06b6d4"
              >
                <div className="flex flex-wrap gap-2">
                  {triggerPhrases.map((phrase, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-[15px] text-cyan-800"
                    >
                      {phrase}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* Evidence */}
            {evidence.length > 0 && (
              <Section
                title="Источники (цитаты из звонков)"
                icon="🔗"
                count={evidence.length}
                accent="#64748b"
              >
                <div className="space-y-3">
                  {evidence.map((ev, i) => (
                    <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                      <blockquote className="border-l-2 border-gray-300 pl-3 text-[15px] text-gray-700 italic leading-relaxed">
                        &ldquo;{ev.quote}&rdquo;
                      </blockquote>
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                        <span className="font-mono">{ev.call_id}</span>
                        <span>@ {formatTimestamp(ev.timestamp_sec)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>

        {/* Comments sidebar */}
        <div className="w-full lg:w-80 flex-shrink-0">
          <div className="lg:sticky lg:top-6">
            <div className="rounded-xl border border-gray-200 bg-white">
              {/* Sidebar header */}
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span className="text-sm font-semibold text-gray-900">Комментарии</span>
                  {comments.length > 0 && (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-600">
                      {comments.length}
                    </span>
                  )}
                </div>
                {!showCommentForm && (
                  <button
                    onClick={() => { setQuotedText(""); setShowCommentForm(true); setTimeout(() => commentFormRef.current?.focus(), 100); }}
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    title="Добавить комментарий"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Comment form */}
              {showCommentForm && (
                <div className="border-b p-4">
                  {quotedText && (
                    <div className="mb-3 rounded-lg border-l-2 border-indigo-400 bg-indigo-50/50 px-3 py-2">
                      <p className="text-xs font-medium text-indigo-500 mb-1">Цитата:</p>
                      <p className="text-sm text-gray-700 italic line-clamp-3">
                        &ldquo;{quotedText}&rdquo;
                      </p>
                    </div>
                  )}
                  <textarea
                    ref={commentFormRef}
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Ваш комментарий..."
                    rows={3}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleAddComment();
                      }
                      if (e.key === "Escape") {
                        handleCancelComment();
                      }
                    }}
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Ctrl+Enter — отправить</span>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCancelComment}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={handleAddComment}
                        disabled={!commentBody.trim() || commentSubmitting}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {commentSubmitting ? "..." : "Отправить"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Comments list */}
              <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
                {comments.length === 0 && !showCommentForm ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-400 mb-1">Нет комментариев</p>
                    <p className="text-xs text-gray-300">Выделите текст в статье, чтобы оставить комментарий</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {comments.map((c) => {
                      const canDelete =
                        user &&
                        (user.id === c.user_id ||
                          user.role === "admin" ||
                          user.role === "superadmin");
                      return (
                        <div key={c.id} className="group p-4">
                          {/* Quoted text */}
                          {c.quoted_text && (
                            <div className="mb-2 rounded border-l-2 border-amber-300 bg-amber-50/50 px-2.5 py-1.5">
                              <p className="text-xs text-gray-600 italic line-clamp-2">
                                &ldquo;{c.quoted_text}&rdquo;
                              </p>
                            </div>
                          )}
                          {/* Comment body */}
                          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                            {c.body}
                          </p>
                          {/* Meta */}
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="text-xs font-medium text-gray-600">
                              {c.user?.name ?? "Пользователь"}
                            </span>
                            {c.user?.role && (
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 uppercase">
                                {c.user.role}
                              </span>
                            )}
                            <span className="text-[11px] text-gray-400">
                              · {relativeTime(c.created_at)}
                            </span>
                            {canDelete && (
                              <button
                                onClick={() => handleDeleteComment(c.id)}
                                className="ml-auto rounded p-0.5 text-gray-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                                title="Удалить"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating comment button — appears on text selection */}
      {floatingBtn && (
        <button
          onClick={handleStartComment}
          style={{
            position: "fixed",
            left: floatingBtn.x,
            top: floatingBtn.y,
            transform: "translate(-50%, -100%)",
          }}
          className="z-50 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-all hover:bg-indigo-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Комментировать
        </button>
      )}
    </div>
  );
}
