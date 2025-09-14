import { useState, useEffect, useMemo } from "react";
import client from "../api/client";
import type { Article, ArticleDetail, ArticleContent } from "../constants/mockData";

/* ── Types ───────────────────────────────────────────────── */

interface GraphNode {
  id: string;
  label: string;
  type: "step" | "branch" | "exception" | "action";
  sublabel?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

/* ── Build graph from article content ────────────────────── */

function buildGraph(content: ArticleContent): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const flow = content.conversation_flow ?? [];
  const exceptions = content.exceptions ?? [];

  // Build step nodes
  flow.forEach((step, i) => {
    const id = `s${i + 1}`;
    nodes.push({
      id,
      label: step.step,
      type: step.action ? "action" : "step",
      sublabel: step.action
        ? step.action
        : step.ask
          ? "Спросить"
          : step.say
            ? "Сказать"
            : undefined,
    });
  });

  // Build linear edges between steps
  // If exceptions exist and flow has >= 3 steps, insert branch after step 2
  const hasBranch = exceptions.length > 0 && flow.length >= 3;

  for (let i = 0; i < flow.length - 1; i++) {
    const from = `s${i + 1}`;
    const to = `s${i + 2}`;

    // Skip edge s2→s3 if we're inserting a branch
    if (hasBranch && i === 1) continue;

    edges.push({ from, to });
  }

  // Insert branch + exception nodes
  if (hasBranch) {
    const branchId = "branch";
    nodes.push({
      id: branchId,
      label: "Проверка условий",
      type: "branch",
    });

    edges.push({ from: "s2", to: branchId });
    edges.push({ from: branchId, to: "s3", label: "Стандарт" });

    exceptions.forEach((exc, j) => {
      const excId = `e${j + 1}`;
      nodes.push({
        id: excId,
        label: exc.condition,
        type: "exception",
        sublabel: exc.price_impact,
      });
      edges.push({ from: branchId, to: excId });
      edges.push({ from: excId, to: "s3" });
    });
  } else if (exceptions.length > 0) {
    // If few steps but have exceptions, show them branching from the last step
    const lastStep = `s${flow.length}`;
    exceptions.forEach((exc, j) => {
      const excId = `e${j + 1}`;
      nodes.push({
        id: excId,
        label: exc.condition,
        type: "exception",
        sublabel: exc.price_impact,
      });
      edges.push({ from: lastStep, to: excId });
    });
  }

  return { nodes, edges };
}

/* ── Layout ──────────────────────────────────────────────── */

const NODE_W = 220;
const NODE_H = 56;
const GAP_Y = 64;
const EXC_GAP_X = 140;
const SVG_PAD = 32;

interface Pos {
  x: number;
  y: number;
}

function layoutNodes(
  nodes: GraphNode[],
  flow: { conversation_flow?: unknown[]; exceptions?: unknown[] },
): Map<string, Pos> {
  const pos = new Map<string, Pos>();

  const stepNodes = nodes.filter((n) => n.id.startsWith("s"));
  const exceptionNodes = nodes.filter((n) => n.id.startsWith("e"));
  const branchNode = nodes.find((n) => n.id === "branch");
  const hasBranch = !!branchNode;

  // Main column X — offset right if we have exceptions (to leave room on the right)
  const excCount = exceptionNodes.length;
  const mainX = SVG_PAD + NODE_W / 2;

  let y = SVG_PAD;

  // Place step nodes vertically
  stepNodes.forEach((node, i) => {
    if (hasBranch && i === 2) {
      // Step 3 goes after the branch + exceptions row
      const excRows = excCount;
      // Branch is at the same Y as step 3 would be, exceptions below it
      // After all exceptions, step 3 continues
      y = SVG_PAD + 2 * (NODE_H + GAP_Y) + (NODE_H + GAP_Y) + excRows * (NODE_H + GAP_Y / 2) + GAP_Y;
    }

    pos.set(node.id, { x: mainX, y });
    y += NODE_H + GAP_Y;
  });

  // Place branch and exception nodes
  if (hasBranch) {
    const branchY = SVG_PAD + 2 * (NODE_H + GAP_Y);
    pos.set("branch", { x: mainX, y: branchY });

    const excX = mainX + NODE_W / 2 + EXC_GAP_X + NODE_W / 2;
    let excY = branchY;

    exceptionNodes.forEach((node) => {
      pos.set(node.id, { x: excX, y: excY });
      excY += NODE_H + GAP_Y / 2;
    });
  } else {
    // Exceptions without branch — place below last step
    const excX = mainX + NODE_W / 2 + EXC_GAP_X + NODE_W / 2;
    exceptionNodes.forEach((node, i) => {
      pos.set(node.id, { x: excX, y: SVG_PAD + i * (NODE_H + GAP_Y / 2) });
    });
  }

  return pos;
}

/* ── Styles ──────────────────────────────────────────────── */

const NODE_STYLE: Record<string, { fill: string; stroke: string; text: string }> = {
  step: { fill: "#ffffff", stroke: "#d1d5db", text: "#111827" },
  branch: { fill: "#fffbeb", stroke: "#fbbf24", text: "#92400e" },
  exception: { fill: "#fff7ed", stroke: "#fb923c", text: "#9a3412" },
  action: { fill: "#f0f9ff", stroke: "#38bdf8", text: "#0c4a6e" },
};

const LEGEND = [
  { type: "step", label: "Шаг" },
  { type: "branch", label: "Ветвление" },
  { type: "exception", label: "Исключение" },
  { type: "action", label: "Действие" },
];

/* ── Component ───────────────────────────────────────────── */

export function DialogGraphPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Load articles list
  useEffect(() => {
    client
      .get("/articles")
      .then((res) => {
        const list: Article[] = res.data;
        setArticles(list);
        if (list.length > 0) {
          setSelectedSlug(list[0].slug);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load selected article detail
  useEffect(() => {
    if (!selectedSlug) return;
    setDetailLoading(true);
    client
      .get(`/articles/${selectedSlug}`)
      .then((res) => setDetail(res.data))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedSlug]);

  // Build graph
  const { nodes, edges } = useMemo(() => {
    if (!detail?.content) return { nodes: [], edges: [] };
    return buildGraph(detail.content);
  }, [detail]);

  const positions = useMemo(
    () => layoutNodes(nodes, detail?.content ?? {}),
    [nodes, detail],
  );

  // Compute SVG dimensions
  const { svgW, svgH } = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    positions.forEach(({ x, y }) => {
      if (x + NODE_W / 2 > maxX) maxX = x + NODE_W / 2;
      if (y + NODE_H > maxY) maxY = y + NODE_H;
    });
    return {
      svgW: maxX + SVG_PAD + 40,
      svgH: maxY + SVG_PAD + 20,
    };
  }, [positions]);

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
        <p className="text-sm text-gray-400">Нет статей</p>
      </div>
    );
  }

  const hasData = nodes.length > 0;

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Граф диалога
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Визуализация шагов диалога и исключений
        </p>
      </div>

      {/* Article selector */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {articles.map((a) => (
          <button
            key={a.slug}
            onClick={() => setSelectedSlug(a.slug)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
              selectedSlug === a.slug
                ? "bg-gray-900 text-white shadow-sm"
                : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {detailLoading ? (
        <div className="py-20 text-center">
          <p className="text-sm text-gray-400">Загрузка графа...</p>
        </div>
      ) : !hasData ? (
        <div className="py-20 text-center">
          <p className="text-sm text-gray-400">
            Нет данных для построения графа
          </p>
        </div>
      ) : (
        <>
          {/* Legend */}
          <div className="mb-6 inline-flex items-center gap-5 rounded-xl border border-gray-200/80 bg-white px-5 py-3">
            {LEGEND.map((l) => {
              const s = NODE_STYLE[l.type];
              return (
                <span key={l.type} className="flex items-center gap-2 text-xs text-gray-500">
                  <span
                    className="inline-block h-3.5 w-3.5 rounded"
                    style={{ backgroundColor: s.fill, border: `2px solid ${s.stroke}` }}
                  />
                  {l.label}
                </span>
              );
            })}
          </div>

          {/* SVG Graph */}
          <div className="overflow-x-auto rounded-2xl border border-gray-200/80 bg-white p-4">
            <svg
              width={svgW}
              height={svgH}
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="mx-auto block"
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
                </marker>
                <filter id="shadow" x="-4%" y="-4%" width="108%" height="116%">
                  <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.08" />
                </filter>
              </defs>

              {/* Edges */}
              {edges.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) return null;

                const isHighlighted =
                  hoveredNode === edge.from || hoveredNode === edge.to;

                const x1 = from.x;
                const y1 = from.y + NODE_H;
                const x2 = to.x;
                const y2 = to.y;

                const midY = (y1 + y2) / 2;
                const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

                return (
                  <g key={`${edge.from}-${edge.to}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke={isHighlighted ? "#6b7280" : "#d1d5db"}
                      strokeWidth={isHighlighted ? 2 : 1.5}
                      markerEnd="url(#arrowhead)"
                      className="transition-colors duration-200"
                    />
                    {edge.label && (
                      <text
                        x={(x1 + x2) / 2 + (x2 > x1 ? 10 : x2 < x1 ? -10 : -20)}
                        y={midY - 4}
                        textAnchor="middle"
                        className="text-[11px] font-medium"
                        fill="#6b7280"
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                const p = positions.get(node.id);
                if (!p) return null;
                const style = NODE_STYLE[node.type];
                const isHovered = hoveredNode === node.id;

                // Truncate label to fit node width
                const maxChars = Math.floor(NODE_W / 8);
                const displayLabel =
                  node.label.length > maxChars
                    ? node.label.slice(0, maxChars - 1) + "…"
                    : node.label;

                return (
                  <g
                    key={node.id}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    className="cursor-default"
                  >
                    <rect
                      x={p.x - NODE_W / 2}
                      y={p.y}
                      width={NODE_W}
                      height={NODE_H}
                      rx={12}
                      fill={style.fill}
                      stroke={isHovered ? style.text : style.stroke}
                      strokeWidth={isHovered ? 2 : 1.5}
                      filter="url(#shadow)"
                      className="transition-all duration-200"
                    />
                    <text
                      x={p.x}
                      y={p.y + (node.sublabel ? 22 : 32)}
                      textAnchor="middle"
                      fill={style.text}
                      className="text-[13px] font-semibold"
                    >
                      {displayLabel}
                    </text>
                    {node.sublabel && (
                      <text
                        x={p.x}
                        y={p.y + 40}
                        textAnchor="middle"
                        fill="#9ca3af"
                        className="text-[11px]"
                      >
                        {node.sublabel.length > maxChars
                          ? node.sublabel.slice(0, maxChars - 1) + "…"
                          : node.sublabel}
                      </text>
                    )}

                    {/* Tooltip on hover */}
                    {isHovered && node.label.length > maxChars && (
                      <>
                        <rect
                          x={p.x - NODE_W / 2}
                          y={p.y - 32}
                          width={NODE_W}
                          height={24}
                          rx={6}
                          fill="#1f2937"
                        />
                        <text
                          x={p.x}
                          y={p.y - 16}
                          textAnchor="middle"
                          fill="white"
                          className="text-[11px]"
                        >
                          {node.label}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
