import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import { useAgentChat, type Source } from "../hooks/useAgentChat";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useVoiceAssistant,
  BarVisualizer,
  useRoomContext,
} from "@livekit/components-react";

// --- LiveKit Voice Agent ---

type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";
type ConvState = "idle" | "listening" | "thinking" | "speaking";

function VoiceVisualizer() {
  const { state, audioTrack } = useVoiceAssistant();

  const statusMap: Record<string, VoiceStatus> = {
    disconnected: "idle",
    connecting: "connecting",
    initializing: "connecting",
    listening: "listening",
    thinking: "thinking",
    speaking: "speaking",
  };
  const voiceStatus: VoiceStatus = statusMap[state] || "listening";

  const statusLabels: Record<VoiceStatus, string> = {
    idle: "",
    connecting: "Подключение...",
    listening: "Слушаю...",
    thinking: "Думаю...",
    speaking: "Отвечаю...",
    error: "Ошибка связи",
  };

  const statusColor =
    voiceStatus === "listening"
      ? "text-green-600"
      : voiceStatus === "thinking"
        ? "text-yellow-600"
        : voiceStatus === "speaking"
          ? "text-blue-600"
          : "text-gray-500";

  const bgColor =
    voiceStatus === "listening"
      ? "bg-green-100"
      : voiceStatus === "thinking"
        ? "bg-yellow-100"
        : voiceStatus === "speaking"
          ? "bg-blue-100"
          : "bg-gray-100";

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      <div className={`flex h-24 w-24 items-center justify-center rounded-full ${bgColor}`}>
        {audioTrack ? (
          <BarVisualizer
            state={state}
            barCount={5}
            trackRef={audioTrack}
            style={{ width: 60, height: 60 }}
          />
        ) : (
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full ${
              voiceStatus === "listening"
                ? "bg-green-500 animate-pulse"
                : voiceStatus === "thinking"
                  ? "bg-yellow-500 animate-spin"
                  : voiceStatus === "speaking"
                    ? "bg-blue-500 animate-pulse"
                    : "bg-gray-400"
            }`}
          >
            <svg
              className="h-7 w-7 text-white"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
              />
            </svg>
          </div>
        )}
      </div>

      <p className={`text-sm font-medium ${statusColor}`}>
        {statusLabels[voiceStatus]}
      </p>
    </div>
  );
}

function DataChannelListener({ onSources }: { onSources: (sources: Source[]) => void }) {
  const room = useRoomContext();

  useEffect(() => {
    const handleData = (payload: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);
        if (data.type === "sources" && Array.isArray(data.sources)) {
          onSources(data.sources);
        }
      } catch {
        // ignore non-JSON data
      }
    };

    room.on("dataReceived", handleData);
    return () => {
      room.off("dataReceived", handleData);
    };
  }, [room, onSources]);

  return null;
}

function useVoiceAgent() {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [token, setToken] = useState("");
  const [livekitUrl, setLivekitUrl] = useState("");

  const connect = useCallback(async () => {
    setVoiceStatus("connecting");
    try {
      const resp = await fetch("/api/agent/token", { method: "POST" });
      if (!resp.ok) throw new Error("Failed to get token");
      const data = await resp.json();

      let url = data.url as string;
      if (url.includes("livekit:")) {
        url = url.replace("livekit:", "localhost:");
      }

      setToken(data.token);
      setLivekitUrl(url);
      setVoiceStatus("listening");
    } catch (err) {
      console.error("Voice connection failed:", err);
      setVoiceStatus("error");
      setTimeout(() => setVoiceStatus("idle"), 3000);
    }
  }, []);

  const disconnect = useCallback(() => {
    setToken("");
    setLivekitUrl("");
    setVoiceStatus("idle");
  }, []);

  const toggle = useCallback(() => {
    if (voiceStatus !== "idle" && voiceStatus !== "error") {
      disconnect();
    } else if (voiceStatus === "idle") {
      connect();
    }
  }, [voiceStatus, connect, disconnect]);

  return { voiceStatus, token, livekitUrl, toggle, disconnect };
}

// --- Speech Input ---

function useSpeechInput(
  onResult: (text: string) => void,
  onInterim: (text: string) => void,
) {
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isSupported = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;

  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec: SpeechRecognition = new SR();
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join("");
      if (e.results[e.results.length - 1].isFinal) onResult(text);
      else onInterim(text);
    };
    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);

    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
  }, [onResult, onInterim]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  const toggle = useCallback(() => {
    if (isRecording) {
      stopListening();
    } else {
      startListening();
    }
  }, [isRecording, startListening, stopListening]);

  return { isSupported, isRecording, toggle, startListening, stopListening };
}

// --- Main Page ---

export function AgentPage() {
  const {
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
  } = useAgentChat();

  const { voiceStatus, token, livekitUrl, toggle: toggleVoice, disconnect: disconnectVoice } =
    useVoiceAgent();

  const [voiceSources, setVoiceSources] = useState<Source[]>([]);
  const [input, setInput] = useState("");

  // Conversation mode state
  const [convState, setConvState] = useState<ConvState>("idle");
  const convStateRef = useRef<ConvState>("idle");
  const convAudioRef = useRef<HTMLAudioElement | null>(null);

  const [ttsVoice, setTtsVoice] = useState("nova");
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { isSupported: isSpeechSupported, isRecording, toggle: toggleMic, startListening, stopListening } = useSpeechInput(
    (text) => {
      if (convStateRef.current === "listening") {
        setConvState("thinking");
        convStateRef.current = "thinking";
        sendMessage(text);
      } else {
        setInput(text);
      }
    },
    (text) => {
      if (convStateRef.current !== "listening") {
        setInput(text);
      }
    },
  );

  const playConvTTS = useCallback(async (text: string) => {
    const { getAccessToken } = await import("../api/client");
    const tkn = getAccessToken();
    try {
      const res = await fetch("/api/agent/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tkn}` },
        body: JSON.stringify({ text, voice: ttsVoice }),
      });
      if (!res.ok) {
        setConvState("idle");
        convStateRef.current = "idle";
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      convAudioRef.current = audio;
      const resume = () => {
        URL.revokeObjectURL(url);
        if (convStateRef.current !== "idle") {
          setConvState("listening");
          convStateRef.current = "listening";
          startListening();
        }
      };
      audio.onended = resume;
      audio.onerror = resume;
      audio.play();
    } catch {
      setConvState("idle");
      convStateRef.current = "idle";
    }
  }, [ttsVoice, startListening]);

  // Trigger TTS when streaming finishes in conversation mode
  useEffect(() => {
    if (!isStreaming && convState === "thinking") {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "assistant" && lastMsg.content) {
        setConvState("speaking");
        convStateRef.current = "speaking";
        playConvTTS(lastMsg.content);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const startConversation = useCallback(() => {
    setConvState("listening");
    convStateRef.current = "listening";
    startListening();
  }, [startListening]);

  const endConversation = useCallback(() => {
    stopListening();
    convAudioRef.current?.pause();
    convAudioRef.current = null;
    setConvState("idle");
    convStateRef.current = "idle";
  }, [stopListening]);

  const playMessage = useCallback(async (text: string, idx: number) => {
    if (playingIdx === idx) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingIdx(null);
      return;
    }
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingIdx(null);

    setLoadingIdx(idx);
    try {
      const { getAccessToken } = await import("../api/client");
      const tkn = getAccessToken();
      const res = await fetch("/api/agent/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tkn}` },
        body: JSON.stringify({ text, voice: ttsVoice }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setLoadingIdx(null);
      setPlayingIdx(idx);
      audio.onended = () => { setPlayingIdx(null); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPlayingIdx(null); URL.revokeObjectURL(url); };
      audio.play();
    } catch {
      setLoadingIdx(null);
    }
  }, [playingIdx, ttsVoice]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  const isVoiceActive = !!token && voiceStatus !== "idle" && voiceStatus !== "error";
  const displaySources = isVoiceActive ? voiceSources : sources;

  useEffect(() => {
    loadSessions();
    if (sessionId > 0) loadSession(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run only on mount to restore last session

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming && convState === "idle") {
      inputRef.current?.focus();
    }
  }, [isStreaming, convState]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) {
      sendMessage(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleVoiceSources = useCallback((newSources: Source[]) => {
    setVoiceSources(newSources);
  }, []);

  const convStateLabels: Record<ConvState, string> = {
    idle: "",
    listening: "Слушаю...",
    thinking: "Думаю...",
    speaking: "Говорю...",
  };

  return (
    <div className="-mx-6 -my-8 flex h-[calc(100vh-3rem)] gap-0">
      {/* Left panel: Chat */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Session selector */}
        <div className="flex items-center gap-2 border-b border-gray-200/60 px-4 py-2">
          <select
            value={sessionId}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id === 0) newChat();
              else loadSession(id);
            }}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
          >
            <option value={0}>Новый чат</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <select
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 focus:border-blue-400 focus:outline-none"
            title="Голос озвучки"
          >
            {["nova", "shimmer", "echo", "alloy", "fable", "onyx"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <button
            onClick={newChat}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            + Новый чат
          </button>
          {sessionId > 0 && (
            <button
              onClick={() => deleteSession(sessionId)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50"
              title="Удалить чат"
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
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !isVoiceActive && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-gray-400">
                <svg
                  className="mx-auto mb-3 h-12 w-12"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                  />
                </svg>
                <p className="text-sm font-medium">Задайте вопрос агенту</p>
                <p className="mt-1 text-xs">
                  Агент ответит на основе базы знаний и прайс-листа
                </p>
              </div>
            </div>
          )}

          {/* Voice mode: LiveKit room */}
          {isVoiceActive && (
            <LiveKitRoom
              token={token}
              serverUrl={livekitUrl}
              connect={true}
              audio={true}
              onDisconnected={disconnectVoice}
            >
              <RoomAudioRenderer />
              <VoiceVisualizer />
              <DataChannelListener onSources={handleVoiceSources} />
            </LiveKitRoom>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[80%] ${msg.role === "assistant" ? "group" : ""}`}>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2">
                      <Markdown>{msg.content || "​"}</Markdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                {msg.role === "assistant" && msg.content && !isStreaming && (
                  <div className="mt-1 flex justify-start opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => playMessage(msg.content, i)}
                      title={playingIdx === i ? "Остановить" : "Озвучить"}
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs transition-colors ${
                        loadingIdx === i
                          ? "bg-gray-200 text-gray-400 animate-pulse cursor-wait"
                          : playingIdx === i
                          ? "bg-blue-100 text-blue-600 hover:bg-blue-200"
                          : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                      }`}
                    >
                      {loadingIdx === i ? (
                        <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                      ) : playingIdx === i ? (
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="6" width="4" height="12" rx="1"/>
                          <rect x="14" y="6" width="4" height="12" rx="1"/>
                        </svg>
                      ) : (
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isStreaming &&
            messages[messages.length - 1]?.role === "assistant" &&
            !messages[messages.length - 1]?.content && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-gray-100 px-4 py-3">
                  <div className="flex gap-1">
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              </div>
            )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area: conversation mode or normal */}
        {convState !== "idle" ? (
          <div className="border-t border-gray-200/60 px-4 py-6 flex flex-col items-center gap-4">
            <div
              className={`h-24 w-24 rounded-full flex items-center justify-center transition-colors ${
                convState === "listening"
                  ? "bg-green-100 animate-pulse"
                  : convState === "thinking"
                    ? "bg-yellow-100"
                    : "bg-blue-100 animate-pulse"
              }`}
            >
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-full ${
                  convState === "listening"
                    ? "bg-green-500"
                    : convState === "thinking"
                      ? "bg-yellow-500"
                      : "bg-blue-500"
                }`}
              >
                {convState === "listening" && (
                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                  </svg>
                )}
                {convState === "thinking" && (
                  <svg className="h-7 w-7 text-white animate-spin" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
                  </svg>
                )}
                {convState === "speaking" && (
                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                  </svg>
                )}
              </div>
            </div>

            <p className={`text-sm font-semibold ${
              convState === "listening" ? "text-green-600" :
              convState === "thinking"  ? "text-yellow-600" :
              "text-blue-600"
            }`}>
              {convStateLabels[convState]}
            </p>

            <button
              onClick={endConversation}
              className="flex items-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15.75 3.75 18 6m0 0 2.25 2.25M18 6l2.25-2.25M18 6l-2.25 2.25m1.5 13.5c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 0 1 4.5 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 0 0-.38 1.21 12.035 12.035 0 0 0 7.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 0 1 1.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 0 1-2.25 2.25h-2.25Z" />
              </svg>
              Завершить разговор
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="border-t border-gray-200/60 px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Введите вопрос..."
                rows={1}
                className="flex-1 resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
                style={{ maxHeight: "120px" }}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 120) + "px";
                }}
              />
              {isSpeechSupported && (
                <>
                  <button
                    type="button"
                    onClick={startConversation}
                    title="Начать разговор"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-600 text-white transition-colors hover:bg-green-700"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.054-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={toggleMic}
                    title={isRecording ? "Остановить запись" : "Говорить"}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                      isRecording
                        ? "bg-red-500 text-white animate-pulse"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                    </svg>
                  </button>
                </>
              )}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500 text-white transition-colors hover:bg-red-600"
                  title="Остановить"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  title="Отправить"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
                    />
                  </svg>
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* Right panel: Sources */}
      <div className="w-80 shrink-0 border-l border-gray-200/60 bg-gray-50/50 overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-200/60">
          <h3 className="text-sm font-semibold text-gray-700">Источники</h3>
        </div>
        <div className="px-4 py-3 space-y-2">
          {displaySources.length === 0 ? (
            <p className="text-xs text-gray-400">
              Источники появятся после ответа агента
            </p>
          ) : (
            displaySources.map((source, i) => (
              <SourceCard
                key={i}
                source={source}
                onClick={() => navigate(`/articles/${source.slug}`)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SourceCard({ source, onClick }: { source: Source; onClick: () => void }) {
  const scorePercent = Math.round(source.score * 100);
  const scoreColor =
    scorePercent >= 80
      ? "text-green-600 bg-green-50"
      : scorePercent >= 60
        ? "text-yellow-600 bg-yellow-50"
        : "text-gray-600 bg-gray-100";

  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left transition-all hover:border-blue-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{source.name}</p>
          <p className="mt-0.5 text-xs text-gray-500">{source.category}</p>
        </div>
        {scorePercent > 0 && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${scoreColor}`}
          >
            {scorePercent}%
          </span>
        )}
      </div>
    </button>
  );
}
