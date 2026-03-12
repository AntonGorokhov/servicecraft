import { useState, useEffect, useCallback } from "react";
import client from "../api/client";

interface LensSettings {
  voice_enabled: boolean;
  chat_enabled: boolean;
  confidence_threshold: number;
  yclients_token: string;
  tts_voice: string;
}

const DEFAULT_SETTINGS: LensSettings = {
  voice_enabled: true,
  chat_enabled: true,
  confidence_threshold: 0.5,
  yclients_token: "",
  tts_voice: "nova",
};

const TTS_VOICES = ["nova", "shimmer", "echo", "alloy", "fable", "onyx"];

export function LensSettingsPage() {
  const [settings, setSettings] = useState<LensSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");

  const fetchSettings = useCallback(async () => {
    try {
      const res = await client.get("/settings");
      const data = res.data as Partial<LensSettings>;
      setSettings({ ...DEFAULT_SETTINGS, ...data });
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await client.put("/settings", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestYClients = async () => {
    setTestStatus("testing");
    try {
      await client.get("/yclients/slots");
      setTestStatus("ok");
      setTimeout(() => setTestStatus("idle"), 3000);
    } catch {
      setTestStatus("error");
      setTimeout(() => setTestStatus("idle"), 3000);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16 text-gray-400">Загрузка...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Настройки</h1>
        <p className="mt-1 text-sm text-gray-500">Конфигурация каналов и интеграций</p>
      </div>

      <div className="space-y-6">
        {/* Channels */}
        <Section title="Каналы">
          <ToggleRow
            label="Голосовой агент"
            description="WebRTC-звонки через браузер (LiveKit)"
            checked={settings.voice_enabled}
            onChange={(v) => setSettings((s) => ({ ...s, voice_enabled: v }))}
          />
          <ToggleRow
            label="Чат-агент"
            description="Текстовый чат с RAG (YandexGPT)"
            checked={settings.chat_enabled}
            onChange={(v) => setSettings((s) => ({ ...s, chat_enabled: v }))}
          />
          <ToggleRow
            label="Telegram-бот"
            description="Интеграция с Telegram (в разработке)"
            checked={false}
            disabled
            onChange={() => {}}
          />
        </Section>

        {/* Agent settings */}
        <Section title="Настройки агента">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Порог уверенности: <span className="font-bold text-blue-600">{settings.confidence_threshold.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={settings.confidence_threshold}
                onChange={(e) => setSettings((s) => ({ ...s, confidence_threshold: parseFloat(e.target.value) }))}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0.1 — отвечать на всё</span>
                <span>1.0 — только точные совпадения</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Голос TTS</label>
              <div className="flex gap-2 flex-wrap">
                {TTS_VOICES.map((v) => (
                  <button
                    key={v}
                    onClick={() => setSettings((s) => ({ ...s, tts_voice: v }))}
                    className={`rounded-full px-3 py-1 text-sm font-medium border transition-colors ${
                      settings.tts_voice === v
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* YClients */}
        <Section title="YClients CRM">
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Интеграция с YClients позволяет агенту записывать клиентов на приём, проверять доступность слотов и получать данные о пациентах.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API-ключ</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={settings.yclients_token}
                  onChange={(e) => setSettings((s) => ({ ...s, yclients_token: e.target.value }))}
                  placeholder="Введите API-ключ YClients..."
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                />
                <button
                  onClick={handleTestYClients}
                  disabled={testStatus === "testing"}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    testStatus === "ok"
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : testStatus === "error"
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {testStatus === "testing" ? "Проверка..." : testStatus === "ok" ? "✓ Подключено" : testStatus === "error" ? "✗ Ошибка" : "Тест"}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              <span className="text-xs text-green-700">Mock-режим активен — слоты и пациенты генерируются автоматически</span>
            </div>
          </div>
        </Section>

        {/* Save */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`rounded-lg px-6 py-2 text-sm font-medium text-white transition-colors ${
              saved ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"
            } disabled:opacity-50`}
          >
            {saving ? "Сохраняю..." : saved ? "✓ Сохранено" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className={`text-sm font-medium ${disabled ? "text-gray-400" : "text-gray-800"}`}>{label}</p>
        <p className="text-xs text-gray-400">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
        } ${checked && !disabled ? "bg-blue-600" : "bg-gray-200"}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
