import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/articles", label: "Статьи" },
  { to: "/clusters", label: "Кластеры" },
  { to: "/graph", label: "Граф" },
  { to: "/pipeline", label: "Pipeline" },
];

export function ContentHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200/60 bg-white/80 backdrop-blur-xl">
      <div className="flex h-12 items-center px-6">
        <nav className="relative flex items-center gap-0.5 rounded-lg bg-gray-100/70 p-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `relative rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
