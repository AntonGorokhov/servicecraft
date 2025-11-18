import { useState, useEffect, useRef, useMemo } from "react";
import client from "../api/client";

interface PriceVariant {
  condition: string;
  price: number;
}

interface PriceEntry {
  service?: string;
  price?: number;
  group?: string;
  services?: PriceEntry[];
  variants?: PriceVariant[];
}

interface PriceCategory {
  category: string;
  services: PriceEntry[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, 80);
}

function buildTreePath(catSlug: string, groupSlugs: string[], name: string): string {
  const parts = [catSlug, ...groupSlugs, slugify(name)];
  return parts.join("--");
}

function formatPrice(price: number): string {
  return price.toLocaleString("ru-RU") + " \u20BD";
}

function ServiceNode({
  entry,
  catSlug,
  groupSlugs,
  searchLower,
  highlightId,
}: {
  entry: PriceEntry;
  catSlug: string;
  groupSlugs: string[];
  searchLower: string;
  highlightId: string | null;
}) {
  const treePath = buildTreePath(catSlug, groupSlugs, entry.service ?? "");
  const isHighlighted = highlightId === treePath;
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHighlighted && nodeRef.current) {
      nodeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  return (
    <div
      ref={nodeRef}
      id={treePath}
      className={`flex items-center justify-between rounded-lg px-3 py-2 transition-all ${
        isHighlighted
          ? "bg-yellow-100 ring-2 ring-yellow-400 animate-pulse"
          : "hover:bg-gray-50"
      }`}
    >
      <span className="text-sm text-gray-800">{entry.service}</span>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        {entry.variants && entry.variants.length > 0 ? (
          <div className="flex flex-col items-end gap-0.5">
            {entry.variants.map((v, i) => (
              <span key={i} className="text-xs text-gray-500">
                <span className="text-gray-400">{v.condition}:</span>{" "}
                <span className="font-semibold text-gray-900">{formatPrice(v.price)}</span>
              </span>
            ))}
          </div>
        ) : entry.price ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            {formatPrice(entry.price)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GroupNode({
  entry,
  catSlug,
  groupSlugs,
  searchLower,
  highlightId,
  defaultOpen,
}: {
  entry: PriceEntry;
  catSlug: string;
  groupSlugs: string[];
  searchLower: string;
  highlightId: string | null;
  defaultOpen: boolean;
}) {
  const newGroupSlugs = [...groupSlugs, slugify(entry.group ?? "")];
  const groupPath = [catSlug, ...newGroupSlugs].join("--");
  const hasHighlight = highlightId && entry.services
    ? containsHighlight(entry.services, groupPath, highlightId)
    : false;
  const [open, setOpen] = useState(defaultOpen || !!hasHighlight);

  useEffect(() => {
    if (searchLower) setOpen(true);
  }, [searchLower]);

  useEffect(() => {
    if (hasHighlight) setOpen(true);
  }, [hasHighlight]);

  return (
    <div className="ml-2 border-l border-gray-200 pl-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        <svg
          className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {entry.group}
        {entry.services && (
          <span className="text-xs text-gray-400">({entry.services.length})</span>
        )}
      </button>
      {open && entry.services && (
        <div className="mt-1 space-y-0.5">
          {entry.services.map((child, i) =>
            child.group ? (
              <GroupNode
                key={i}
                entry={child}
                catSlug={catSlug}
                groupSlugs={newGroupSlugs}
                searchLower={searchLower}
                highlightId={highlightId}
                defaultOpen={!!searchLower}
              />
            ) : (
              <ServiceNode
                key={i}
                entry={child}
                catSlug={catSlug}
                groupSlugs={newGroupSlugs}
                searchLower={searchLower}
                highlightId={highlightId}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

// Check if any service in entries has a treePath matching highlightId
function containsHighlight(entries: PriceEntry[], pathPrefix: string, highlightId: string): boolean {
  for (const e of entries) {
    if (e.group && e.services) {
      const groupPath = pathPrefix + "--" + slugify(e.group);
      if (containsHighlight(e.services, groupPath, highlightId)) return true;
    } else if (e.service) {
      const svcPath = pathPrefix + "--" + slugify(e.service);
      if (svcPath === highlightId) return true;
    }
  }
  return false;
}

function CategorySection({
  cat,
  searchLower,
  highlightId,
}: {
  cat: PriceCategory;
  searchLower: string;
  highlightId: string | null;
}) {
  const catSlug = slugify(cat.category);
  const hasHighlight = highlightId ? containsHighlight(cat.services, catSlug, highlightId) : false;
  const [open, setOpen] = useState(hasHighlight);

  useEffect(() => {
    if (searchLower) setOpen(true);
  }, [searchLower]);

  useEffect(() => {
    if (hasHighlight) setOpen(true);
  }, [hasHighlight]);

  // Count all leaf services
  function countServices(entries: PriceEntry[]): number {
    let n = 0;
    for (const e of entries) {
      if (e.group && e.services) n += countServices(e.services);
      else if (e.service) n++;
    }
    return n;
  }

  const total = useMemo(() => countServices(cat.services), [cat.services]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50"
      >
        <span className="text-xl">{cat.category.match(/^\S+/)?.[0]}</span>
        <span className="flex-1 text-base font-semibold text-gray-900">
          {cat.category.replace(/^\S+\s*/, "")}
        </span>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
          {total}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t px-4 pb-4 pt-3 space-y-0.5">
          {cat.services.map((entry, i) =>
            entry.group ? (
              <GroupNode
                key={i}
                entry={entry}
                catSlug={catSlug}
                groupSlugs={[]}
                searchLower={searchLower}
                highlightId={highlightId}
                defaultOpen={!!searchLower}
              />
            ) : (
              <ServiceNode
                key={i}
                entry={entry}
                catSlug={catSlug}
                groupSlugs={[]}
                searchLower={searchLower}
                highlightId={highlightId}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

// Filter the tree to only show entries matching the search query
function filterTree(tree: PriceCategory[], searchLower: string): PriceCategory[] {
  if (!searchLower) return tree;

  function filterEntries(entries: PriceEntry[]): PriceEntry[] {
    const result: PriceEntry[] = [];
    for (const e of entries) {
      if (e.group && e.services) {
        const filtered = filterEntries(e.services);
        if (filtered.length > 0) {
          result.push({ ...e, services: filtered });
        }
      } else if (e.service && e.service.toLowerCase().includes(searchLower)) {
        result.push(e);
      }
    }
    return result;
  }

  const filtered: PriceCategory[] = [];
  for (const cat of tree) {
    const services = filterEntries(cat.services);
    if (services.length > 0) {
      filtered.push({ ...cat, services });
    }
  }
  return filtered;
}

export function PriceTreePage() {
  const [tree, setTree] = useState<PriceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    client
      .get("/price-tree")
      .then((res) => setTree(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Handle hash linking
  useEffect(() => {
    if (!tree.length) return;
    const hash = window.location.hash.slice(1);
    if (hash) {
      setHighlightId(decodeURIComponent(hash));
      // Clear highlight after animation
      const timer = setTimeout(() => setHighlightId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [tree]);

  const searchLower = search.toLowerCase().trim();
  const filteredTree = useMemo(() => filterTree(tree, searchLower), [tree, searchLower]);

  // Count total services
  function countAll(entries: PriceEntry[]): number {
    let n = 0;
    for (const e of entries) {
      if (e.group && e.services) n += countAll(e.services);
      else if (e.service) n++;
    }
    return n;
  }
  const totalServices = useMemo(
    () => tree.reduce((sum, cat) => sum + countAll(cat.services), 0),
    [tree]
  );

  if (loading) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-gray-400">Загрузка прайс-листа...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Прайс-лист</h1>
        <p className="mt-1 text-sm text-gray-500">
          {tree.length} категорий, {totalServices} услуг
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
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
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск услуги..."
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tree */}
      {filteredTree.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-400">Ничего не найдено</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTree.map((cat, i) => (
            <CategorySection
              key={i}
              cat={cat}
              searchLower={searchLower}
              highlightId={highlightId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
