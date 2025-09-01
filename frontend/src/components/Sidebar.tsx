import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function Sidebar() {
  const { user, logout } = useAuth();

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-gray-200/60 bg-white">
      {/* Logo */}
      <div className="flex h-14 items-center px-5">
        <span className="text-lg font-extrabold tracking-tight text-gray-900">
          Service<span className="text-blue-600">Craft</span>
        </span>
      </div>

      {/* Services */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        <NavLink
          to="/articles"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`
          }
        >
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          База знаний
        </NavLink>
      </nav>

      {/* User section */}
      <div className="border-t border-gray-200/60 px-3 py-3">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-xs font-bold text-white shadow-sm">
            {initials}
          </div>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">
            {user?.name}
          </span>
          <button
            onClick={logout}
            title="Выйти"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3-3h-9m9 0-3-3m3 3-3 3" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
