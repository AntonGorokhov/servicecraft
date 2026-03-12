import { useState, useEffect, useCallback, useRef } from "react";
import client from "../api/client";

interface Question {
  id: number;
  external_id: string;
  question: string;
  answer: string;
  ai_answer: string;
  ai_status: string;
  theme_id: string;
  theme_name: string;
  frequency: number;
  is_faq: boolean;
  evidence: EvidenceItem[];
  status: "scripted" | "unscripted";
  rag_approved: boolean;
  indexed_at: string | null;
  updated_at: string;
}

interface EvidenceItem {
  call_id: string;
  snippet: string;
  start_offset: number;
  end_offset: number;
}

interface Stats {
  total: number;
  scripted: number;
  pending: number;
  acceptance_rate: number;
}

export function QuestionQueuePage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [themes, setThemes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const statusFilter = "unscripted";
  const [themeFilter, setThemeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draftText, setDraftText] = useState<Record<number, string>>({});
  const [answerText, setAnswerText] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const fetchStats = useCallback(async () => {
    const res = await client.get("/questions/stats");
    setStats(res.data);
  }, []);

  const fetchThemes = useCallback(async () => {
    const res = await client.get("/questions/themes");
    setThemes(res.data);
  }, []);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (themeFilter) params.set("theme", themeFilter);
      if (search) params.set("search", search);
      const res = await client.get(`/questions?${params}`);
      const data: Question[] = res.data.map((q: Question) => ({
        ...q,
        evidence: Array.isArray(q.evidence) ? q.evidence : [],
      }));
      setQuestions(data);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, themeFilter, search]);

  useEffect(() => {
    fetchStats();
    fetchThemes();
  }, [fetchStats, fetchThemes]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const handleExpand = (q: Question) => {
    if (expandedId === q.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(q.id);
    setAnswerText((prev) => ({ ...prev, [q.id]: q.answer }));
    setDraftText((prev) => ({ ...prev, [q.id]: q.ai_answer || "" }));
  };

  const handleAcceptDraft = async (q: Question) => {
    setSaving((s) => ({ ...s, [q.id]: true }));
    try {
      const res = await client.post(`/questions/${q.id}/accept-draft`);
      setQuestions((qs) => qs.map((item) => (item.id === q.id ? { ...res.data, evidence: item.evidence } : item)));
      setAnswerText((prev) => ({ ...prev, [q.id]: res.data.answer }));
      fetchStats();
    } finally {
      setSaving((s) => ({ ...s, [q.id]: false }));
    }
  };

  const handleSaveAnswer = async (q: Question) => {
    const answer = answerText[q.id] ?? q.answer;
    setSaving((s) => ({ ...s, [q.id]: true }));
    try {
      const res = await client.put(`/questions/${q.id}/answer`, { answer });
      setQuestions((qs) => qs.map((item) => (item.id === q.id ? { ...res.data, evidence: item.evidence } : item)));
      fetchStats();
    } finally {
      setSaving((s) => ({ ...s, [q.id]: false }));
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexResult(null);
    try {
      const res = await client.post("/questions/reindex");
      setReindexResult(`Проиндексировано: ${res.data.indexed}`);
      fetchQuestions();
      setTimeout(() => setReindexResult(null), 4000);
    } catch {
      setReindexResult("Ошибка индексации");
      setTimeout(() => setReindexResult(null), 3000);
    } finally {
      setReindexing(false);
    }
  };

  const handleExport = async () => {
    const res = await client.get("/questions/export");
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vetkb-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await client.post("/questions/import", data);
      alert(`Импорт завершён: создано ${res.data.created}, обновлено ${res.data.updated}`);
      fetchStats();
      fetchThemes();
      fetchQuestions();
    } catch (err) {
      alert("Ошибка импорта: " + String(err));
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const progress = stats ? Math.round((stats.scripted / stats.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Очередь скриптования</h1>
          <p className="mt-1 text-sm text-gray-500">
            Вопросы без ответа — скриптуй и публикуй в базу Q&amp;A
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              onClick={handleReindex}
              disabled={reindexing}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition-colors ${
                reindexResult
                  ? reindexResult.startsWith("Ошибка")
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-green-200 bg-green-50 text-green-700"
                  : "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
              } disabled:opacity-50`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
              </svg>
              {reindexing ? "Индексирую..." : reindexResult ?? "В RAG"}
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Экспорт
            </button>
            <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-100 ${importing ? "opacity-50" : ""}`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              {importing ? "Импорт..." : "Импорт"}
              <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} disabled={importing} />
            </label>
          </div>
        </div>
      </div>

      {/* Progress */}
      {stats && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-orange-500">{stats.pending}</span>
              <span className="ml-1 text-sm text-gray-500">вопросов ожидают ответа</span>
            </div>
            <div className="text-right text-sm text-gray-500">
              <div>Отвечено: <span className="font-semibold text-green-600">{stats.scripted}</span> / {stats.total}</div>
              <div>Покрытие: <span className="font-semibold text-blue-600">{((stats.scripted / stats.total) * 100).toFixed(1)}%</span></div>
            </div>
          </div>
          <div className="h-2.5 w-full rounded-full bg-gray-100">
            <div
              className="h-2.5 rounded-full bg-green-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 text-right text-xs text-gray-400">{progress}%</div>
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
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm min-w-48"
        />
      </div>

      {/* Question list */}
      {loading ? (
        <div className="flex justify-center py-16 text-gray-400">Загрузка...</div>
      ) : questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center text-gray-400">
          Нет вопросов по выбранным фильтрам
        </div>
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              expanded={expandedId === q.id}
              onExpand={() => handleExpand(q)}
              answerValue={answerText[q.id] ?? q.answer}
              draftValue={draftText[q.id] ?? q.ai_answer}
              onAnswerChange={(v) => setAnswerText((prev) => ({ ...prev, [q.id]: v }))}
              onAcceptDraft={() => handleAcceptDraft(q)}
              onSave={() => handleSaveAnswer(q)}
              saving={saving[q.id] ?? false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  question: Question;
  expanded: boolean;
  onExpand: () => void;
  answerValue: string;
  draftValue: string;
  onAnswerChange: (v: string) => void;
  onAcceptDraft: () => void;
  onSave: () => void;
  saving: boolean;
}

function QuestionCard({ question: q, expanded, onExpand, answerValue, draftValue, onAnswerChange, onAcceptDraft, onSave, saving }: CardProps) {
  const [showEvidence, setShowEvidence] = useState(false);

  return (
    <div className={`rounded-xl border bg-white shadow-sm transition-all ${expanded ? "border-blue-200 shadow-md" : "border-gray-200 hover:border-gray-300"}`}>
      {/* Card header */}
      <button
        onClick={onExpand}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 leading-snug">{q.question}</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {q.theme_name && (
              <span className="text-xs text-gray-400">{q.theme_name}</span>
            )}
            {q.is_faq && (
              <span className="text-xs text-purple-500 font-medium">FAQ</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
            </svg>
            {q.frequency}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            q.status === "scripted"
              ? "bg-green-50 text-green-700"
              : "bg-orange-50 text-orange-600"
          }`}>
            {q.status === "scripted" ? "Отвечено" : "Без ответа"}
          </span>
          {q.rag_approved && (
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700" title={q.indexed_at ? `Проиндексировано: ${new Date(q.indexed_at).toLocaleDateString("ru")}` : ""}>
              В RAG
            </span>
          )}
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {/* Expanded scripting panel */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          {/* AI draft */}
          {draftValue && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">AI-черновик</span>
                <button
                  onClick={onAcceptDraft}
                  disabled={saving}
                  className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
                >
                  {saving ? "Сохраняю..." : "Принять →"}
                </button>
              </div>
              <p className="text-sm text-blue-800 leading-relaxed whitespace-pre-wrap">{draftValue}</p>
            </div>
          )}

          {/* Answer textarea */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Ответ оператора
            </label>
            <textarea
              value={answerValue}
              onChange={(e) => onAnswerChange(e.target.value)}
              rows={4}
              placeholder="Введите ответ для клиента..."
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 resize-y"
            />
          </div>

          <div className="flex items-center justify-between">
            {/* Evidence toggle */}
            {q.evidence.length > 0 && (
              <button
                onClick={() => setShowEvidence((v) => !v)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {showEvidence ? "Скрыть" : `Показать ${q.evidence.length} упоминаний из звонков`}
              </button>
            )}
            <div className="ml-auto">
              <button
                onClick={onSave}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Сохраняю..." : "Утвердить → Q&A"}
              </button>
            </div>
          </div>

          {/* Evidence snippets */}
          {showEvidence && q.evidence.length > 0 && (
            <div className="space-y-2">
              {q.evidence.slice(0, 5).map((ev, i) => (
                <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-xs italic text-gray-600 leading-relaxed">«{ev.snippet}»</p>
                  <p className="mt-0.5 text-xs text-gray-400">{ev.call_id}</p>
                </div>
              ))}
              {q.evidence.length > 5 && (
                <p className="text-xs text-gray-400">+{q.evidence.length - 5} ещё</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
