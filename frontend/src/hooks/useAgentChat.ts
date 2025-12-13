import { useState, useCallback, useRef } from "react";
import { getAccessToken } from "../api/client";

export interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  created_at?: string;
}

export interface Source {
  slug: string;
  name: string;
  category: string;
  score: number;
}

interface Session {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<number>(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const loadSessions = useCallback(async () => {
    const token = getAccessToken();
    const res = await fetch("/api/agent/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setSessions(await res.json());
    }
  }, []);

  const loadSession = useCallback(async (id: number) => {
    const token = getAccessToken();
    const res = await fetch(`/api/agent/sessions/${id}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const msgs: ChatMessage[] = await res.json();
      setMessages(msgs);
      setSessionId(id);
      // Extract sources from last assistant message
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      if (lastAssistant?.sources) {
        setSources(lastAssistant.sources);
      } else {
        setSources([]);
      }
    }
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    setSources([]);
    setSessionId(0);
  }, []);

  const deleteSession = useCallback(
    async (id: number) => {
      const token = getAccessToken();
      await fetch(`/api/agent/sessions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (sessionId === id) {
        newChat();
      }
      await loadSessions();
    },
    [sessionId, newChat, loadSessions]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming || !text.trim()) return;

      const userMsg: ChatMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setSources([]);

      const assistantMsg: ChatMessage = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = getAccessToken();
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: text, session_id: sessionId }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);
                if (eventType === "token") {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant") {
                      updated[updated.length - 1] = {
                        ...last,
                        content: last.content + parsed.text,
                      };
                    }
                    return updated;
                  });
                } else if (eventType === "sources") {
                  setSources(parsed as Source[]);
                } else if (eventType === "done") {
                  setSessionId(parsed.session_id);
                } else if (eventType === "error") {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant") {
                      updated[updated.length - 1] = {
                        ...last,
                        content: "Ошибка: " + parsed.error,
                      };
                    }
                    return updated;
                  });
                }
              } catch {
                // skip unparseable lines
              }
            } else if (line === "") {
              eventType = "";
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant" && !last.content) {
              updated[updated.length - 1] = {
                ...last,
                content: "Ошибка подключения к серверу.",
              };
            }
            return updated;
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        loadSessions();
      }
    },
    [isStreaming, sessionId, loadSessions]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    sources,
    isStreaming,
    sessionId,
    sessions,
    sendMessage,
    stopStreaming,
    loadSessions,
    loadSession,
    newChat,
    deleteSession,
  };
}
