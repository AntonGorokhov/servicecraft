import { useState, useEffect, useCallback } from "react";
import client from "../api/client";

interface Stats {
  total: number;
  scripted: number;
  pending: number;
  acceptance_rate: number;
}

interface TopQuestion {
  id: number;
  question: string;
  theme_name: string;
  frequency: number;
  status: "scripted" | "unscripted";
  rag_approved: boolean;
}

const RAG_METRICS = [
  { label: "BLEU", value: 0.38, color: "blue" },
  { label: "ROUGE-L", value: 0.41, color: "indigo" },
  { label: "BERTScore", value: 0.80, color: "violet" },
];

export function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [topQuestions, setTopQuestions] = useState<TopQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, topRes] = await Promise.all([
        client.get("/questions/stats"),
        client.get("/questions?limit=10"),
      ]);
      setStats(statsRes.data);
      setTopQuestions(topRes.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div className="flex justify-center py-16 text-gray-400">Загрузка...</div>;
  }

  const coverage = stats ? (stats.scripted / stats.total) * 100 : 0;
  const indexed = topQuestions.filter((q) => q.rag_approved).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Аналитика</h1>
        <p className="mt-1 text-sm text-gray-500">Метрики системы Human-in-the-Loop Knowledge Base</p>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KPICard label="Всего вопросов" value={stats.total} sub="уникальных из звонков" color="gray" />
          <KPICard label="Отвечено" value={stats.scripted} sub={`${coverage.toFixed(1)}% покрытие`} color="green" />
          <KPICard label="Без ответа" value={stats.pending} sub="ожидают скриптования" color="orange" />
          <KPICard label="LLM acceptance" value={`${stats.acceptance_rate.toFixed(1)}%`} sub="AI-черновики приняты" color="blue" />
        </div>
      )}

      {/* KB Coverage */}
      {stats && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Покрытие базы знаний</h2>
            <span className="text-sm font-medium text-gray-700">
              <span className="text-xl font-bold text-blue-600">{stats.scripted}</span>
              <span className="text-gray-400"> / {stats.total} вопросов отвечено</span>
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-100">
            <div
              className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
              style={{ width: `${coverage}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
            <span>{coverage.toFixed(1)}% KB Coverage</span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              {indexed} из {Math.min(10, topQuestions.length)} показанных — в RAG
            </span>
          </div>
        </div>
      )}

      {/* RAG Metrics */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Метрики качества RAG
          <span className="ml-2 text-xs font-normal normal-case text-gray-400">(оценено на тестовой выборке 50 вопросов)</span>
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {RAG_METRICS.map((m) => (
            <div key={m.label} className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
              <div className={`text-3xl font-bold text-${m.color}-600`}>{m.value.toFixed(2)}</div>
              <div className="mt-1 text-sm font-medium text-gray-600">{m.label}</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200">
                <div
                  className={`h-1.5 rounded-full bg-${m.color}-400`}
                  style={{ width: `${m.value * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Hybrid Search Architecture */}
      <div className="rounded-xl border border-purple-100 bg-gradient-to-br from-purple-50 to-indigo-50 p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-purple-600">Архитектура Hybrid RAG</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ArchChip label="Запрос пользователя" color="gray" />
          <Arrow />
          <ArchChip label="OpenAI text-embedding-3-large" color="blue" sub="dense · 1024d · cosine" />
          <ArchChip label="BM25 Sparse Encoder" color="indigo" sub="vocab 2826 · Robertson IDF" />
          <Arrow />
          <ArchChip label="Qdrant qa_pairs" color="violet" sub="prefetch dense + sparse" />
          <Arrow />
          <ArchChip label="RRF Fusion" color="purple" sub="k=60 · top-5" />
          <Arrow />
          <ArchChip label="YandexGPT Pro" color="green" sub="streaming · context window" />
        </div>
      </div>

      {/* Top-10 Questions */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Топ-10 вопросов по частоте
        </h2>
        <div className="overflow-hidden rounded-lg border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-2.5 text-left">#</th>
                <th className="px-4 py-2.5 text-left">Вопрос</th>
                <th className="px-4 py-2.5 text-left">Тема</th>
                <th className="px-4 py-2.5 text-right">Звонков</th>
                <th className="px-4 py-2.5 text-center">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {topQuestions.map((q, i) => (
                <tr key={q.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3 text-gray-800 max-w-xs">
                    <span className="line-clamp-2 leading-snug">{q.question}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{q.theme_name || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-700">{q.frequency}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        q.status === "scripted" ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-600"
                      }`}>
                        {q.status === "scripted" ? "✓" : "…"}
                      </span>
                      {q.rag_approved && (
                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">RAG</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  const colorMap: Record<string, string> = {
    gray: "text-gray-900",
    green: "text-green-600",
    orange: "text-orange-500",
    blue: "text-blue-600",
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colorMap[color] ?? "text-gray-900"}`}>{value}</p>
      <p className="mt-0.5 text-xs text-gray-400">{sub}</p>
    </div>
  );
}

function ArchChip({ label, sub, color }: { label: string; sub?: string; color: string }) {
  const colorMap: Record<string, string> = {
    gray: "border-gray-200 bg-white text-gray-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    purple: "border-purple-200 bg-purple-50 text-purple-700",
    green: "border-green-200 bg-green-50 text-green-700",
  };
  return (
    <div className={`rounded-lg border px-3 py-1.5 text-center ${colorMap[color] ?? colorMap.gray}`}>
      <div className="text-xs font-semibold">{label}</div>
      {sub && <div className="text-xs opacity-60">{sub}</div>}
    </div>
  );
}

function Arrow() {
  return <span className="text-gray-300 font-bold">→</span>;
}
