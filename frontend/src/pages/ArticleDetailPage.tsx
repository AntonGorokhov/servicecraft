import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ARTICLE_DETAILS } from "../constants/mockData";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../constants/categories";

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
        <span className="text-lg">{icon}</span>
        <span className="flex-1 text-sm font-semibold text-gray-900">
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
      {open && <div className="border-t px-5 pb-5 pt-4">{children}</div>}
    </div>
  );
}

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const article = id ? ARTICLE_DETAILS[id] : undefined;

  if (!article) {
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

  return (
    <div className="mx-auto max-w-3xl">
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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          {article.name}
        </h1>
      </div>

      {/* Sections */}
      <div className="flex flex-col gap-3">
        {/* Conversation Flow */}
        <Section
          title="Шаги диалога"
          icon="💬"
          count={article.conversation_flow.length}
          defaultOpen
          accent={colors.dot}
        >
          <ol className="space-y-4">
            {article.conversation_flow.map((step, i) => (
              <li key={i} className="relative pl-8">
                <span className="absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{step.step}</p>
                  {step.ask && (
                    <p className="mt-1 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      <span className="font-medium">Спросить:</span> {step.ask}
                    </p>
                  )}
                  {step.say && (
                    <p className="mt-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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
        </Section>

        {/* Clarifying Questions */}
        <Section
          title="Уточняющие вопросы"
          icon="❓"
          count={article.clarifying_questions.length}
          accent="#3b82f6"
        >
          <div className="space-y-3">
            {article.clarifying_questions.map((q, i) => (
              <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-900">{q.question}</p>
                <p className="mt-1 text-xs text-gray-500">{q.why}</p>
                <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  Влияние: {q.impact}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Exceptions */}
        <Section
          title="Исключения"
          icon="⚡"
          count={article.exceptions.length}
          accent="#f59e0b"
        >
          <div className="space-y-3">
            {article.exceptions.map((ex, i) => (
              <div key={i} className="rounded-lg border border-amber-100 bg-amber-50/50 p-4">
                <p className="text-sm font-semibold text-amber-900">{ex.condition}</p>
                <p className="mt-1 text-sm text-gray-700">{ex.action}</p>
                <span className="mt-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                  {ex.price_impact}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* Services & Prices */}
        <Section
          title="Услуги и цены"
          icon="💰"
          count={article.services_and_prices.length}
          accent="#10b981"
        >
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-2.5">Услуга</th>
                  <th className="px-4 py-2.5">Цена</th>
                  <th className="px-4 py-2.5 hidden sm:table-cell">Условие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {article.services_and_prices.map((s, i) => (
                  <tr key={i} className={s.mandatory ? "bg-emerald-50/40" : ""}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{s.service}</span>
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

        {/* Red Flags */}
        <Section
          title="Красные флаги"
          icon="🚨"
          count={article.red_flags.length}
          accent="#ef4444"
        >
          <div className="space-y-3">
            {article.red_flags.map((rf, i) => (
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
                  <p className="text-sm font-semibold text-gray-900">{rf.signal}</p>
                </div>
                <p className="mt-2 text-sm text-gray-700">{rf.action}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Never Say */}
        <Section
          title="Чего не говорить"
          icon="🚫"
          count={article.never_say.length}
          accent="#6b7280"
        >
          <ul className="space-y-2">
            {article.never_say.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
              >
                <span className="mt-0.5 text-red-400">✕</span>
                {item}
              </li>
            ))}
          </ul>
        </Section>

        {/* FAQ */}
        <Section
          title="Частые вопросы"
          icon="📋"
          count={article.faq.length}
          accent="#8b5cf6"
        >
          <div className="space-y-3">
            {article.faq.map((item, i) => (
              <div key={i} className="rounded-lg border border-gray-100 p-4">
                <p className="text-sm font-semibold text-gray-900">{item.q}</p>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Trigger Phrases */}
        <Section
          title="Триггерные фразы"
          icon="🎯"
          count={article.trigger_phrases.length}
          accent="#06b6d4"
        >
          <div className="flex flex-wrap gap-2">
            {article.trigger_phrases.map((phrase, i) => (
              <span
                key={i}
                className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm text-cyan-800"
              >
                {phrase}
              </span>
            ))}
          </div>
        </Section>

        {/* Evidence */}
        <Section
          title="Источники (цитаты из звонков)"
          icon="🔗"
          count={article.evidence.length}
          accent="#64748b"
        >
          <div className="space-y-3">
            {article.evidence.map((ev, i) => (
              <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <blockquote className="border-l-2 border-gray-300 pl-3 text-sm text-gray-700 italic leading-relaxed">
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
      </div>
    </div>
  );
}
