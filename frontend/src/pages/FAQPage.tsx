import { useState, useEffect, useCallback, useRef } from "react";
import client from "../api/client";

interface FAQEntry {
  id: number;
  slug: string;
  title: string;
  category: string;
  content: Record<string, unknown>;
}

interface QA {
  q: string;
  a: string;
}

interface Branch {
  name: string;
  address: string;
  hours: string;
  phone: string;
}

export function FAQPage() {
  const [entries, setEntries] = useState<FAQEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({});

  const fetchEntries = useCallback(async () => {
    try {
      const res = await client.get("/faq");
      setEntries(res.data);
    } catch (err) {
      console.error("Failed to load FAQ:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const getEntry = (slug: string) => entries.find((e) => e.slug === slug);

  const saveEntry = useCallback(
    async (slug: string, content: Record<string, unknown>) => {
      setSaveStatus((s) => ({ ...s, [slug]: "saving" }));
      try {
        await client.put(`/faq/${slug}`, { content });
        setEntries((prev) =>
          prev.map((e) => (e.slug === slug ? { ...e, content } : e))
        );
        setSaveStatus((s) => ({ ...s, [slug]: "saved" }));
        setTimeout(() => setSaveStatus((s) => ({ ...s, [slug]: undefined as never })), 1500);
      } catch {
        setSaveStatus((s) => ({ ...s, [slug]: "error" }));
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  const clinicInfo = getEntry("clinic_info");
  const commonQuestions = getEntry("common_questions");

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Настройки FAQ</h1>
        <p className="mt-1 text-sm text-gray-500">
          Информация о клинике, часто задаваемые вопросы и филиалы
        </p>
      </div>

      {clinicInfo && (
        <ClinicInfoSection
          entry={clinicInfo}
          status={saveStatus["clinic_info"]}
          onSave={(content) => saveEntry("clinic_info", content)}
        />
      )}

      {commonQuestions && (
        <FAQSection
          entry={commonQuestions}
          status={saveStatus["common_questions"]}
          onSave={(content) => saveEntry("common_questions", content)}
        />
      )}

      {clinicInfo && (
        <BranchesSection
          entry={clinicInfo}
          status={saveStatus["clinic_info"]}
          onSave={(content) => saveEntry("clinic_info", content)}
        />
      )}
    </div>
  );
}

function SaveIndicator({ status }: { status?: "saving" | "saved" | "error" }) {
  if (!status) return null;
  return (
    <span
      className={`ml-3 inline-flex items-center gap-1 text-xs font-medium transition-opacity ${
        status === "saving"
          ? "text-blue-500"
          : status === "saved"
            ? "text-green-600"
            : "text-red-500"
      }`}
    >
      {status === "saving" && (
        <span className="h-3 w-3 animate-spin rounded-full border border-blue-500 border-t-transparent" />
      )}
      {status === "saving" ? "Сохранение..." : status === "saved" ? "Сохранено" : "Ошибка"}
    </span>
  );
}

function ClinicInfoSection({
  entry,
  status,
  onSave,
}: {
  entry: FAQEntry;
  status?: "saving" | "saved" | "error";
  onSave: (content: Record<string, unknown>) => void;
}) {
  const content = entry.content as Record<string, unknown>;
  const [name, setName] = useState((content.name as string) || "");
  const [operatorName, setOperatorName] = useState(
    (content.operator_name as string) || ""
  );

  const save = useCallback(
    (field: string, value: string) => {
      onSave({ ...content, [field]: value });
    },
    [content, onSave]
  );

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
      <div className="flex items-center">
        <h2 className="text-lg font-bold text-gray-900">Информация о клинике</h2>
        <SaveIndicator status={status} />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Название клиники
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => save("name", name)}
            className="w-full rounded-lg border border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Название"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Имя оператора
          </label>
          <input
            type="text"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            onBlur={() => save("operator_name", operatorName)}
            className="w-full rounded-lg border border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Имя оператора"
          />
        </div>
      </div>
    </div>
  );
}

function FAQSection({
  entry,
  status,
  onSave,
}: {
  entry: FAQEntry;
  status?: "saving" | "saved" | "error";
  onSave: (content: Record<string, unknown>) => void;
}) {
  const content = entry.content as Record<string, unknown>;
  const [questions, setQuestions] = useState<QA[]>(
    (content.questions as QA[]) || []
  );
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const contentRef = useRef(content);
  contentRef.current = content;

  const persist = useCallback(
    (updated: QA[]) => {
      setQuestions(updated);
      saveRef.current({ ...contentRef.current, questions: updated });
    },
    []
  );

  const startEdit = (idx: number) => {
    setEditIdx(idx);
    setEditQ(questions[idx].q);
    setEditA(questions[idx].a);
  };

  const commitEdit = () => {
    if (editIdx === null) return;
    const updated = [...questions];
    updated[editIdx] = { q: editQ, a: editA };
    persist(updated);
    setEditIdx(null);
  };

  const cancelEdit = () => setEditIdx(null);

  const addRow = () => {
    const updated = [...questions, { q: "", a: "" }];
    setQuestions(updated);
    setEditIdx(updated.length - 1);
    setEditQ("");
    setEditA("");
  };

  const deleteRow = (idx: number) => {
    persist(questions.filter((_, i) => i !== idx));
    if (editIdx === idx) setEditIdx(null);
  };

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <h2 className="text-lg font-bold text-gray-900">Часто задаваемые вопросы</h2>
          <SaveIndicator status={status} />
        </div>
        <button
          onClick={addRow}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          + Добавить
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Вопрос</th>
              <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Ответ</th>
              <th className="w-24 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {questions.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                  Нет вопросов
                </td>
              </tr>
            )}
            {questions.map((qa, i) =>
              editIdx === i ? (
                <tr key={i} className="border-b border-gray-100 bg-blue-50/30">
                  <td className="px-3 py-2">
                    <textarea
                      value={editQ}
                      onChange={(e) => setEditQ(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder="Вопрос"
                      autoFocus
                    />
                  </td>
                  <td className="px-3 py-2">
                    <textarea
                      value={editA}
                      onChange={(e) => setEditA(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder="Ответ"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        onClick={commitEdit}
                        className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
                      >
                        OK
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                      >
                        Отмена
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={i}
                  className="group border-b border-gray-100 transition-colors hover:bg-gray-50/50"
                >
                  <td className="px-4 py-3 text-gray-800">{qa.q || <span className="text-gray-300 italic">пусто</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{qa.a || <span className="text-gray-300 italic">пусто</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => startEdit(i)}
                        className="rounded-md p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                        title="Редактировать"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteRow(i)}
                        className="rounded-md p-1 text-gray-400 hover:bg-red-100 hover:text-red-600"
                        title="Удалить"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BranchesSection({
  entry,
  status,
  onSave,
}: {
  entry: FAQEntry;
  status?: "saving" | "saved" | "error";
  onSave: (content: Record<string, unknown>) => void;
}) {
  const content = entry.content as Record<string, unknown>;
  const [branches, setBranches] = useState<Branch[]>(
    (content.branches as Branch[]) || []
  );
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState<Branch>({ name: "", address: "", hours: "", phone: "" });
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const contentRef = useRef(content);
  contentRef.current = content;

  const persist = useCallback(
    (updated: Branch[]) => {
      setBranches(updated);
      saveRef.current({ ...contentRef.current, branches: updated });
    },
    []
  );

  const startEdit = (idx: number) => {
    setEditIdx(idx);
    setForm({ ...branches[idx] });
  };

  const commitEdit = () => {
    if (editIdx === null) return;
    const updated = [...branches];
    updated[editIdx] = { ...form };
    persist(updated);
    setEditIdx(null);
  };

  const cancelEdit = () => setEditIdx(null);

  const addRow = () => {
    const updated = [...branches, { name: "", address: "", hours: "", phone: "" }];
    setBranches(updated);
    setEditIdx(updated.length - 1);
    setForm({ name: "", address: "", hours: "", phone: "" });
  };

  const deleteRow = (idx: number) => {
    persist(branches.filter((_, i) => i !== idx));
    if (editIdx === idx) setEditIdx(null);
  };

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <h2 className="text-lg font-bold text-gray-900">Филиалы</h2>
          <SaveIndicator status={status} />
        </div>
        <button
          onClick={addRow}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          + Добавить
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Название</th>
              <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Адрес</th>
              <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Часы работы</th>
              <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Телефон</th>
              <th className="w-24 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {branches.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Нет филиалов
                </td>
              </tr>
            )}
            {branches.map((b, i) =>
              editIdx === i ? (
                <tr key={i} className="border-b border-gray-100 bg-blue-50/30">
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder="Название"
                      autoFocus
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder="Адрес"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={form.hours}
                      onChange={(e) => setForm({ ...form, hours: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder="09:00–21:00"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder="+7 ..."
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        onClick={commitEdit}
                        className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
                      >
                        OK
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                      >
                        Отмена
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={i}
                  className="group border-b border-gray-100 transition-colors hover:bg-gray-50/50"
                >
                  <td className="px-4 py-3 font-medium text-gray-800">{b.name || <span className="text-gray-300 italic">—</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{b.address || <span className="text-gray-300 italic">—</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{b.hours || <span className="text-gray-300 italic">—</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{b.phone || <span className="text-gray-300 italic">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => startEdit(i)}
                        className="rounded-md p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                        title="Редактировать"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteRow(i)}
                        className="rounded-md p-1 text-gray-400 hover:bg-red-100 hover:text-red-600"
                        title="Удалить"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
