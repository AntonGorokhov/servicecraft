import { useState, useEffect, useCallback } from "react";
import client from "../api/client";

interface QAPair {
  id: number;
  question: string;
  answer: string;
  theme_name: string;
  frequency: number;
  rag_approved: boolean;
  indexed_at: string | null;
  ai_status: string;
  updated_at: string;
}

export function QAPage() {
  const [pairs, setPairs] = useState<QAPair[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [themeFilter, setThemeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editAnswers, setEditAnswers] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});

  const fetchPairs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: "scripted" });
      if (themeFilter) params.set("theme", themeFilter);
      if (search) params.set("search", search);
      const [pairsRes, themesRes] = await Promise.all([
        client.get(`/questions?${params}`),
        client.get("/questions/themes"),
      ]);
      setPairs(pairsRes.data);
      setThemes(themesRes.data);
    } finally {
      setLoading(false);
    }
  }, [themeFilter, search]);

  useEffect(() => {
    fetchPairs();
  }, [fetchPairs]);

  const handleApprove = async (pair: QAPair) => {
    const answer = editAnswers[pair.id] ?? pair.answer;
    if (!answer.trim()) return;
    setSaving((s) => ({ ...s, [pair.id]: true }));
    try {
      const res = await client.put(`/questions/${pair.id}/answer`, { answer });
      setPairs((ps) => ps.map((p) => (p.id === pair.id ? { ...p, ...res.data } : p)));
      setSaved((s) => ({ ...s, [pair.id]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [pair.id]: false })), 2500);
    } finally {
      setSaving((s) => ({ ...s, [pair.id]: false }));
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">База Q&amp;A</h1>
        <p className="mt-1 text-sm text-gray-500">
          Отвеченные пары — используются агентом в RAG. Редактируй и утверждай для переиндексации.
        </p>
      </div>

      {/* Stats chip */}
      {!loading && (
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
            {pairs.length} пар
          </span>
          <span className="rounded-full bg-purple-50 px-3 py-1 text-sm font-medium text-purple-700">
            {pairs.filter((p) => p.rag_approved).length} в RAG
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={themeFilter}
          onChange={(e) => setThemeFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm"
        >
          <option value="">Все темы</option>
          {themes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Поиск по вопросу..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16 text-gray-400">Загрузка...</div>
      ) : pairs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center text-gray-400">
          Нет отвеченных пар
        </div>
      ) : (
        <div className="space-y-3">
          {pairs.map((pair) => {
            const currentAnswer = editAnswers[pair.id] ?? pair.answer;
            const isDirty = currentAnswer !== pair.answer;
            const isSaving = saving[pair.id] ?? false;
            const isSaved = saved[pair.id] ?? false;

            return (
              <div
                key={pair.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Question row */}
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 leading-snug">{pair.question}</p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {pair.theme_name && (
                        <span className="text-xs text-gray-400">{pair.theme_name}</span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                        </svg>
                        {pair.frequency}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {pair.rag_approved && (
                      <span
                        className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700"
                        title={pair.indexed_at ? `Проиндексировано: ${new Date(pair.indexed_at).toLocaleDateString("ru")}` : ""}
                      >
                        В RAG
                      </span>
                    )}
                  </div>
                </div>

                {/* Answer editor */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Ответ
                  </label>
                  <textarea
                    value={currentAnswer}
                    onChange={(e) =>
                      setEditAnswers((prev) => ({ ...prev, [pair.id]: e.target.value }))
                    }
                    rows={3}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-200 resize-y"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleApprove(pair)}
                      disabled={isSaving || (!isDirty && pair.rag_approved && !isSaved)}
                      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                        isSaved
                          ? "bg-green-600 text-white"
                          : isDirty
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
                      }`}
                    >
                      {isSaving
                        ? "Сохраняю..."
                        : isSaved
                        ? "✓ Сохранено"
                        : isDirty
                        ? "Утвердить изменения"
                        : "Утвердить в RAG"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
