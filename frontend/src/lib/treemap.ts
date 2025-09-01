export interface TreemapItem {
  id: string;
  value: number;
  [key: string]: unknown;
}

export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  item: TreemapItem;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worst(row: number[], sideLen: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const maxVal = Math.max(...row);
  const minVal = Math.min(...row);
  const s2 = sum * sum;
  const w2 = sideLen * sideLen;
  return Math.max((w2 * maxVal) / s2, s2 / (w2 * minVal));
}

function layoutRow(row: TreemapItem[], areas: Map<TreemapItem, number>, rect: Rect): { rects: TreemapRect[]; remaining: Rect } {
  const rowAreas = row.map((item) => areas.get(item)!);
  const totalArea = rowAreas.reduce((a, b) => a + b, 0);

  const horizontal = rect.w >= rect.h;
  const sideLen = horizontal ? rect.h : rect.w;
  const rowLen = sideLen === 0 ? 0 : totalArea / sideLen;

  const rects: TreemapRect[] = [];
  let offset = 0;

  for (let i = 0; i < row.length; i++) {
    const itemLen = sideLen === 0 ? 0 : rowAreas[i] / rowLen;
    if (horizontal) {
      rects.push({ x: rect.x, y: rect.y + offset, w: rowLen, h: itemLen, item: row[i] });
    } else {
      rects.push({ x: rect.x + offset, y: rect.y, w: itemLen, h: rowLen, item: row[i] });
    }
    offset += itemLen;
  }

  const remaining: Rect = horizontal
    ? { x: rect.x + rowLen, y: rect.y, w: rect.w - rowLen, h: rect.h }
    : { x: rect.x, y: rect.y + rowLen, w: rect.w, h: rect.h - rowLen };

  return { rects, remaining };
}

export function squarify(items: TreemapItem[], rect: Rect): TreemapRect[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const totalValue = sorted.reduce((s, it) => s + it.value, 0);
  const totalArea = rect.w * rect.h;

  const areas = new Map<TreemapItem, number>();
  for (const item of sorted) {
    areas.set(item, (item.value / totalValue) * totalArea);
  }

  const result: TreemapRect[] = [];
  let remaining = { ...rect };
  let i = 0;

  while (i < sorted.length) {
    const shortSide = Math.min(remaining.w, remaining.h);
    const row: TreemapItem[] = [sorted[i]];
    let rowAreas = [areas.get(sorted[i])!];
    i++;

    while (i < sorted.length) {
      const newRowAreas = [...rowAreas, areas.get(sorted[i])!];
      if (worst(newRowAreas, shortSide) <= worst(rowAreas, shortSide)) {
        row.push(sorted[i]);
        rowAreas = newRowAreas;
        i++;
      } else {
        break;
      }
    }

    const { rects, remaining: newRemaining } = layoutRow(row, areas, remaining);
    result.push(...rects);
    remaining = newRemaining;
  }

  return result;
}
