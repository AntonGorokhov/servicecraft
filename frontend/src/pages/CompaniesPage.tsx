import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import client from "../api/client";
import { CreateCompanyModal } from "../components/CreateCompanyModal";
import { CreateUserModal } from "../components/CreateUserModal";

interface Company {
  id: number;
  name: string;
  slug: string;
}

interface CompanyUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

const roleBadge: Record<string, { label: string; cls: string }> = {
  superadmin: { label: "Суперадмин", cls: "bg-purple-100 text-purple-700" },
  admin: { label: "Админ", cls: "bg-blue-100 text-blue-700" },
  operator: { label: "Оператор", cls: "bg-gray-100 text-gray-700" },
};

export function CompaniesPage() {
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [expandedCompany, setExpandedCompany] = useState<number | null>(null);
  const [companyUsers, setCompanyUsers] = useState<Record<number, CompanyUser[]>>({});
  const [showCreateUser, setShowCreateUser] = useState<number | null>(null);

  useEffect(() => {
    loadCompanies();
  }, []);

  if (user?.role !== "superadmin") {
    return <Navigate to="/articles" replace />;
  }

  async function loadCompanies() {
    try {
      const res = await client.get("/admin/companies");
      setCompanies(res.data ?? []);
    } catch {
      /* ignore */
    }
  }

  async function loadUsers(companyId: number) {
    try {
      const res = await client.get(`/admin/companies/${companyId}/users`);
      setCompanyUsers((prev) => ({ ...prev, [companyId]: res.data ?? [] }));
    } catch {
      /* ignore */
    }
  }

  async function handleToggleCompany(companyId: number) {
    if (expandedCompany === companyId) {
      setExpandedCompany(null);
    } else {
      setExpandedCompany(companyId);
      if (!companyUsers[companyId]) await loadUsers(companyId);
    }
  }

  async function handleDeleteCompany(id: number) {
    if (!confirm("Удалить компанию?")) return;
    try {
      await client.delete(`/admin/companies/${id}`);
      setCompanies((prev) => prev.filter((c) => c.id !== id));
    } catch {
      alert("Не удалось удалить компанию");
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Компании</h1>
          <button
            onClick={() => setShowCreateCompany(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + Добавить компанию
          </button>
        </div>

        {companies.length === 0 ? (
          <p className="text-sm text-gray-500">Нет компаний</p>
        ) : (
          <div className="space-y-2">
            {companies.map((company) => (
              <div
                key={company.id}
                className="rounded-xl border border-gray-200 bg-gray-50/50"
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <button
                    onClick={() => handleToggleCompany(company.id)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-900"
                  >
                    <svg
                      className={`h-4 w-4 transition-transform ${expandedCompany === company.id ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m8.25 4.5 7.5 7.5-7.5 7.5"
                      />
                    </svg>
                    {company.name}
                    <span className="text-xs text-gray-400">
                      ({company.slug})
                    </span>
                  </button>
                  <button
                    onClick={() => handleDeleteCompany(company.id)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    title="Удалить"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                      />
                    </svg>
                  </button>
                </div>

                {expandedCompany === company.id && (
                  <div className="border-t border-gray-200 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Пользователи
                      </span>
                      <button
                        onClick={() => setShowCreateUser(company.id)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        + Добавить
                      </button>
                    </div>
                    {(companyUsers[company.id] ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400">
                        Нет пользователей
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {companyUsers[company.id].map((u) => (
                          <li
                            key={u.id}
                            className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm"
                          >
                            <span className="text-gray-700">
                              {u.name}{" "}
                              <span className="text-gray-400">
                                ({u.email})
                              </span>
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${(roleBadge[u.role] ?? roleBadge.operator).cls}`}
                            >
                              {(roleBadge[u.role] ?? roleBadge.operator).label}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateCompany && (
        <CreateCompanyModal
          onClose={() => setShowCreateCompany(false)}
          onCreated={() => {
            setShowCreateCompany(false);
            loadCompanies();
          }}
        />
      )}

      {showCreateUser !== null && (
        <CreateUserModal
          companyId={showCreateUser}
          onClose={() => setShowCreateUser(null)}
          onCreated={() => {
            loadUsers(showCreateUser);
            setShowCreateUser(null);
          }}
        />
      )}
    </div>
  );
}
