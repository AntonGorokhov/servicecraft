import { useState } from "react";

/* ── Data ────────────────────────────────────────────────── */

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

const NODES: GraphNode[] = [
  { id: "s1", label: "Выяснить возраст и породу", type: "step", sublabel: "Спросить" },
  { id: "s2", label: "Уточнить здоровье", type: "step", sublabel: "Спросить" },
  { id: "b1", label: "Мейн-кун?", type: "branch" },
  { id: "e1", label: "ЭКГ + УЗИ сердца", type: "exception", sublabel: "+2 000 ₽" },
  { id: "s3", label: "Стандартная подготовка", type: "step" },
  { id: "s4", label: "Объяснить подготовку", type: "step", sublabel: "Голодная диета 8-12 ч" },
  { id: "s5", label: "Назвать стоимость", type: "step", sublabel: "5 500 ₽" },
  { id: "a1", label: "Предложить дату", type: "action", sublabel: "check_slots" },
  { id: "s6", label: "Подтвердить запись", type: "step" },
];

const EDGES: GraphEdge[] = [
  { from: "s1", to: "s2" },
  { from: "s2", to: "b1" },
  { from: "b1", to: "e1", label: "Да" },
  { from: "b1", to: "s3", label: "Нет" },
  { from: "e1", to: "s4" },
  { from: "s3", to: "s4" },
  { from: "s4", to: "s5" },
  { from: "s5", to: "a1" },
  { from: "a1", to: "s6" },
];

/* ── Layout constants ────────────────────────────────────── */

const NODE_W = 220;
const NODE_H = 56;
const GAP_Y = 64;
const BRANCH_GAP_X = 160;
const SVG_PAD = 32;

/* Position each node */
interface Pos { x: number; y: number }

function layoutNodes(): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  const cx = SVG_PAD + BRANCH_GAP_X + NODE_W / 2;
  let y = SVG_PAD;

  // s1
  pos.set("s1", { x: cx, y });
  y += NODE_H + GAP_Y;

  // s2
  pos.set("s2", { x: cx, y });
  y += NODE_H + GAP_Y;

  // b1 — branch
  pos.set("b1", { x: cx, y });
  y += NODE_H + GAP_Y;

  // Branch children: e1 (left), s3 (right)
  const leftX = cx - BRANCH_GAP_X;
  const rightX = cx + BRANCH_GAP_X;
  pos.set("e1", { x: leftX, y });
  pos.set("s3", { x: rightX, y });
  y += NODE_H + GAP_Y;

  // Merge: s4 back on center
  pos.set("s4", { x: cx, y });
  y += NODE_H + GAP_Y;

  pos.set("s5", { x: cx, y });
  y += NODE_H + GAP_Y;

  pos.set("a1", { x: cx, y });
  y += NODE_H + GAP_Y;

  pos.set("s6", { x: cx, y });

  return pos;
}

/* ── Styles ──────────────────────────────────────────────── */

const NODE_STYLE: Record<string, { fill: string; stroke: string; text: string }> = {
  step:      { fill: "#ffffff", stroke: "#d1d5db", text: "#111827" },
  branch:    { fill: "#fffbeb", stroke: "#fbbf24", text: "#92400e" },
  exception: { fill: "#fff7ed", stroke: "#fb923c", text: "#9a3412" },
  action:    { fill: "#f0f9ff", stroke: "#38bdf8", text: "#0c4a6e" },
};

const LEGEND = [
  { type: "step", label: "Шаг" },
  { type: "branch", label: "Ветвление" },
  { type: "exception", label: "Исключение" },
  { type: "action", label: "Действие" },
];

/* ── Component ───────────────────────────────────────────── */

export function DialogGraphPage() {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const positions = layoutNodes();

  /* Compute SVG dimensions */
  let maxX = 0;
  let maxY = 0;
  positions.forEach(({ x, y }) => {
    if (x + NODE_W / 2 > maxX) maxX = x + NODE_W / 2;
    if (y + NODE_H > maxY) maxY = y + NODE_H;
  });
  const svgW = maxX + SVG_PAD + 40;
  const svgH = maxY + SVG_PAD + 20;

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Граф диалога
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Кластер: <span className="font-medium text-gray-600">Стерилизация кошки</span>
        </p>
      </div>

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
          {EDGES.map((edge) => {
            const from = positions.get(edge.from)!;
            const to = positions.get(edge.to)!;
            const isHighlighted =
              hoveredNode === edge.from || hoveredNode === edge.to;

            /* Start from bottom-center of source, end at top-center of target */
            const x1 = from.x;
            const y1 = from.y + NODE_H;
            const x2 = to.x;
            const y2 = to.y;

            /* Bezier control points for smooth curves */
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
                    x={(x1 + x2) / 2 + (x2 > x1 ? 10 : -10)}
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
          {NODES.map((node) => {
            const pos = positions.get(node.id)!;
            const style = NODE_STYLE[node.type];
            const isHovered = hoveredNode === node.id;

            return (
              <g
                key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-default"
              >
                <rect
                  x={pos.x - NODE_W / 2}
                  y={pos.y}
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
                  x={pos.x}
                  y={pos.y + (node.sublabel ? 22 : 32)}
                  textAnchor="middle"
                  fill={style.text}
                  className="text-[13px] font-semibold"
                >
                  {node.label}
                </text>
                {node.sublabel && (
                  <text
                    x={pos.x}
                    y={pos.y + 40}
                    textAnchor="middle"
                    fill="#9ca3af"
                    className="text-[11px]"
                  >
                    {node.sublabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
