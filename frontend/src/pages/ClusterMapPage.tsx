import { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../constants/categories";
import type { Article } from "../constants/mockData";
import { squarify } from "../lib/treemap";
import client from "../api/client";

const TREEMAP_HEIGHT = 500;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function ClusterMapPage() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get("/articles")
      .then((res) => setArticles(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const items = useMemo(
    () =>
      articles.map((c) => ({
        id: c.slug,
        value: c.call_count,
        cluster: c,
      })),
    [articles]
  );

  const rects = useMemo(
    () => squarify(items, { x: 0, y: 0, w: 100, h: 100 }),
    [items]
  );

  const usedCategories = useMemo(() => {
    const cats = new Set(articles.map((c) => c.category));
    return [...cats];
  }, [articles]);

  if (loading) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-gray-400">Загрузка...</p>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-gray-400">Нет данных для отображения</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Карта кластеров
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Площадь блока = количество звонков. Цвет = категория.
        </p>
      </div>

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl border border-gray-200/80"
        style={{ height: TREEMAP_HEIGHT }}
      >
        {rects.map((r) => {
          const cluster = r.item.cluster as Article;
          const colors =
            CATEGORY_COLORS[cluster.category] ?? CATEGORY_COLORS.general;
          const label =
            CATEGORY_LABELS[cluster.category] ?? cluster.category;
          const isHovered = hovered === cluster.slug;

          const widthPx = (r.w / 100) * (containerRef.current?.clientWidth ?? 800);
          const heightPx = (r.h / 100) * TREEMAP_HEIGHT;
          const isSmall = widthPx < 120 || heightPx < 80;
          const isTiny = widthPx < 70 || heightPx < 50;

          return (
            <div
              key={cluster.slug}
              onClick={() => navigate(`/articles/${cluster.slug}`)}
              onMouseEnter={() => setHovered(cluster.slug)}
              onMouseLeave={() => setHovered(null)}
              className={`absolute cursor-pointer border border-white/60 p-2 transition-all duration-150
                ${isHovered ? "z-10 ring-2 ring-blue-400 shadow-lg" : ""}`}
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                width: `${r.w}%`,
                height: `${r.h}%`,
                backgroundColor: hexToRgba(colors.dot, 0.15),
              }}
            >
              <div className="flex h-full flex-col justify-between overflow-hidden">
                {isTiny ? (
                  <span className="text-xs font-bold text-gray-700">
                    {cluster.call_count}
                  </span>
                ) : isSmall ? (
                  <>
                    <span className="truncate text-xs font-semibold text-gray-800">
                      {cluster.name}
                    </span>
                    <span className="text-xs font-bold text-gray-600">
                      {cluster.call_count}
                    </span>
                  </>
                ) : (
                  <>
                    <div>
                      <span
                        className="mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor: hexToRgba(colors.dot, 0.2),
                          color: colors.dot,
                        }}
                      >
                        {label}
                      </span>
                      <h3 className="mt-1 text-sm font-semibold leading-snug text-gray-900">
                        {cluster.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-bold text-gray-700">
                        {cluster.call_count} звонков
                      </span>
                      <span>·</span>
                      <span>{cluster.steps} шагов</span>
                      <span>·</span>
                      <span>{cluster.exceptions} искл.</span>
                    </div>
                  </>
                )}
              </div>

              {isHovered && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-52 -translate-x-1/2 rounded-lg bg-gray-900 p-3 text-xs text-white shadow-xl">
                  <p className="mb-1 font-semibold">{cluster.name}</p>
                  <p>Звонков: {cluster.call_count}</p>
                  <p>Шагов: {cluster.steps}</p>
                  <p>Исключений: {cluster.exceptions}</p>
                  <p>Обновлено: {cluster.last_updated}</p>
                  <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {usedCategories.map((cat) => {
          const colors = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general;
          const label = CATEGORY_LABELS[cat] ?? cat;
          return (
            <div key={cat} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: colors.dot }}
              />
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
