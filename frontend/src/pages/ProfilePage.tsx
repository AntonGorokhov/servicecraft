import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import client from "../api/client";

const roleBadge: Record<string, { label: string; cls: string }> = {
  superadmin: { label: "Суперадмин", cls: "bg-purple-100 text-purple-700" },
  admin: { label: "Админ", cls: "bg-blue-100 text-blue-700" },
  operator: { label: "Оператор", cls: "bg-gray-100 text-gray-700" },
};

export function ProfilePage() {
  const { user, updateUser } = useAuth();

  // Profile edit
  const [name, setName] = useState(user?.name ?? "");
  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setProfileMsg("");
    setProfileErr("");
    setSavingProfile(true);
    try {
      const res = await client.put("/auth/profile", { name });
      updateUser({ name: res.data.name });
      setProfileMsg("Профиль обновлён");
    } catch {
      setProfileErr("Ошибка при обновлении профиля");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPwMsg("");
    setPwErr("");
    if (newPw !== confirmPw) {
      setPwErr("Пароли не совпадают");
      return;
    }
    setSavingPw(true);
    try {
      await client.put("/auth/password", {
        current_password: currentPw,
        new_password: newPw,
      });
      setPwMsg("Пароль изменён");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch {
      setPwErr("Не удалось изменить пароль");
    } finally {
      setSavingPw(false);
    }
  }

  if (!user) return null;

  const initials = user.name
    ? user.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  const badge = roleBadge[user.role] ?? roleBadge.operator;

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      {/* Profile card */}
      <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-xl font-bold text-white shadow">
            {initials}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{user.name}</h1>
            <p className="text-sm text-gray-500">{user.email}</p>
            <span
              className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}
            >
              {badge.label}
            </span>
            {user.company_name && (
              <span className="ml-2 inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                {user.company_name}
              </span>
            )}
          </div>
        </div>

        <form onSubmit={handleProfileSubmit} className="space-y-4">
          {profileMsg && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {profileMsg}
            </div>
          )}
          {profileErr && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {profileErr}
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Имя
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-sm text-gray-500"
            />
          </div>
          <button
            type="submit"
            disabled={savingProfile}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingProfile ? "Сохранение..." : "Сохранить"}
          </button>
        </form>
      </div>

      {/* Password change */}
      <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Смена пароля</h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {pwMsg && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {pwMsg}
            </div>
          )}
          {pwErr && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {pwErr}
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Текущий пароль
            </label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Новый пароль
            </label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-lg border border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Подтвердите пароль
            </label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-lg border border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <button
            type="submit"
            disabled={savingPw}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingPw ? "Изменение..." : "Изменить пароль"}
          </button>
        </form>
      </div>
    </div>
  );
}
