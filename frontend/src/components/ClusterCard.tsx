import { Link } from "react-router-dom";
import { CATEGORY_COLORS, CATEGORY_LABELS, type DemoCluster } from "../constants/categories";

interface Props {
  cluster: DemoCluster;
}

export function ClusterCard({ cluster }: Props) {
  const colors = CATEGORY_COLORS[cluster.category] ?? CATEGORY_COLORS.general;
  const label = CATEGORY_LABELS[cluster.category] ?? cluster.category;

  return (
    <Link
      to={`/articles/${cluster.id}`}
      className="group block rounded-xl border border-gray-200/80 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-gray-200/50"
      style={{ borderLeftWidth: 3, borderLeftColor: colors.dot }}
    >
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors.bg} ${colors.text}`}
          >
            {label}
          </span>
          <svg
            className="h-4 w-4 text-gray-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>

        <h3 className="mb-2 text-[15px] font-semibold text-gray-900 leading-snug">
          {cluster.name}
        </h3>

        <div className="mb-3 flex items-center gap-1.5 text-sm text-gray-400">
          <span>{cluster.callCount} звонков</span>
          <span>·</span>
          <span>{cluster.lastUpdated}</span>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="rounded bg-gray-50 px-2 py-0.5">
            {cluster.steps} шагов
          </span>
          <span className="rounded bg-gray-50 px-2 py-0.5">
            {cluster.exceptions} искл.
          </span>
        </div>
      </div>
    </Link>
  );
}
