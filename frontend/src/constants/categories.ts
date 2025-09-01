export const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  preventive:      { bg: "bg-green-50",    text: "text-green-700",      dot: "#22c55e" },
  urological:      { bg: "bg-blue-50",     text: "text-blue-700",       dot: "#3b82f6" },
  emergency:       { bg: "bg-red-50",      text: "text-red-700",        dot: "#ef4444" },
  admin:           { bg: "bg-gray-50",     text: "text-gray-600",       dot: "#94a3b8" },
  gi:              { bg: "bg-orange-50",   text: "text-orange-700",     dot: "#f97316" },
  dermatology:     { bg: "bg-pink-50",     text: "text-pink-700",       dot: "#f472b6" },
  reproductive:    { bg: "bg-purple-50",   text: "text-purple-700",     dot: "#a855f7" },
  dental:          { bg: "bg-cyan-50",     text: "text-cyan-700",       dot: "#06b6d4" },
  ophthalmology:   { bg: "bg-teal-50",     text: "text-teal-700",       dot: "#14b8a6" },
  musculoskeletal: { bg: "bg-indigo-50",   text: "text-indigo-700",     dot: "#6366f1" },
  cardiology:      { bg: "bg-red-100",     text: "text-red-800",        dot: "#dc2626" },
  neurology:       { bg: "bg-violet-50",   text: "text-violet-700",     dot: "#7c3aed" },
  respiratory:     { bg: "bg-sky-50",      text: "text-sky-700",        dot: "#38bdf8" },
  oncology:        { bg: "bg-orange-100",  text: "text-orange-800",     dot: "#ea580c" },
  general:         { bg: "bg-stone-50",    text: "text-stone-600",      dot: "#78716c" },
};

export const CATEGORY_LABELS: Record<string, string> = {
  preventive:      "Профилактика",
  urological:      "Урология",
  emergency:       "Экстренные",
  admin:           "Администрирование",
  gi:              "ЖКТ",
  dermatology:     "Дерматология",
  reproductive:    "Репродукция",
  dental:          "Стоматология",
  ophthalmology:   "Офтальмология",
  musculoskeletal: "Опорно-двигательная",
  cardiology:      "Кардиология",
  neurology:       "Неврология",
  respiratory:     "Респираторная",
  oncology:        "Онкология",
  general:         "Общее",
};

export interface DemoCluster {
  id: string;
  name: string;
  category: string;
  callCount: number;
  lastUpdated: string;
  steps: number;
  exceptions: number;
}

export const DEMO_CLUSTERS: DemoCluster[] = [
  { id: "cat_sterilization",  name: "Стерилизация кошки",  category: "preventive", callCount: 12, lastUpdated: "1 мар",  steps: 6, exceptions: 3 },
  { id: "blood_in_urine",     name: "Кровь в моче",        category: "urological", callCount: 8,  lastUpdated: "28 фев", steps: 4, exceptions: 2 },
  { id: "poisoning",          name: "Отравление",           category: "emergency",  callCount: 3,  lastUpdated: "25 фев", steps: 5, exceptions: 2 },
  { id: "price_inquiry",      name: "Узнать цену",          category: "admin",      callCount: 15, lastUpdated: "2 мар",  steps: 3, exceptions: 1 },
  { id: "dog_vaccination",    name: "Вакцинация щенка",    category: "preventive", callCount: 7,  lastUpdated: "27 фев", steps: 5, exceptions: 2 },
  { id: "tick_bite",          name: "Укус клеща",            category: "emergency",  callCount: 5,  lastUpdated: "26 фев", steps: 4, exceptions: 3 },
];
