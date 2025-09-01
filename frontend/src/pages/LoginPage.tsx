import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/articles" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      setError("Неверный email или пароль");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-page)]">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl shadow-gray-200/60">
        <div className="h-1.5 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600" />
        <div className="p-8">
          <h1 className="mb-1 text-center text-2xl font-extrabold tracking-tight text-gray-900">
            Service<span className="text-blue-600">Craft</span>
          </h1>
          <p className="mb-8 text-center text-sm text-gray-400">
            Платформа сервисов
          </p>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="user@servicecraft.local"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Пароль
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-blue-800 hover:shadow-md disabled:opacity-50"
            >
              {submitting ? "Вход..." : "Войти"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
