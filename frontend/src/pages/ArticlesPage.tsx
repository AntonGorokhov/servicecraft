import { useState } from "react";
import { ClusterCard } from "../components/ClusterCard";
import {
  DEMO_CLUSTERS,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
} from "../constants/categories";

export function ArticlesPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = Array.from(new Set(DEMO_CLUSTERS.map((c) => c.category)));

  const filtered = DEMO_CLUSTERS.filter((c) => {
    if (category !== "all" && c.category !== category) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div>
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Статьи
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {DEMO_CLUSTERS.length} кластеров знаний
        </p>
      </div>

      {/* Search + filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-xs w-full">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Поиск кластеров..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategory("all")}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
              category === "all"
                ? "bg-gray-900 text-white shadow-sm"
                : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            Все
          </button>
          {categories.map((cat) => {
            const colors = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general;
            const isActive = category === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategory(isActive ? "all" : cat)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                  isActive
                    ? `${colors.bg} ${colors.text} shadow-sm ring-1 ring-current/20`
                    : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 hover:text-gray-700"
                }`}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((cluster) => (
          <ClusterCard key={cluster.id} cluster={cluster} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mt-16 text-center">
          <p className="text-sm text-gray-400">Ничего не найдено</p>
        </div>
      )}
    </div>
  );
}
