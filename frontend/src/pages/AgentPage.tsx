import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import { useAgentChat, type Source } from "../hooks/useAgentChat";

type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

function useVoiceAgent() {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [partialText, setPartialText] = useState("");
  const [lastResponse, setLastResponse] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);

  const playNextChunk = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playbackCtxRef.current;

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift()!;
      const int16 = new Int16Array(chunk);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    }

    isPlayingRef.current = false;
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setVoiceStatus("connecting");
    setPartialText("");
    setLastResponse("");

    try {
      // Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // WebSocket
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/voice/ws`);
      wsRef.current = ws;

      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        setVoiceStatus("listening");
        // Send config
        ws.send(JSON.stringify({ type: "config", session_id: 0 }));

        // Set up audio capture: ScriptProcessorNode to get PCM
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        // 4096 samples buffer, mono in, no out
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          // Convert float32 → int16 PCM
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(int16.buffer);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Audio data from TTS
          audioQueueRef.current.push(event.data);
          playNextChunk();
          return;
        }

        const data = JSON.parse(event.data);
        switch (data.type) {
          case "partial":
            setPartialText(data.text);
            break;
          case "transcript":
            setPartialText("");
            break;
          case "response":
            setLastResponse(data.text);
            break;
          case "audio_end":
            // All audio sent
            break;
          case "interrupt":
            // Barge-in: stop audio playback
            audioQueueRef.current = [];
            isPlayingRef.current = false;
            if (playbackCtxRef.current) {
              playbackCtxRef.current.close();
              playbackCtxRef.current = null;
            }
            break;
          case "status":
            if (data.status === "thinking") setVoiceStatus("thinking");
            else if (data.status === "speaking") setVoiceStatus("speaking");
            else if (data.status === "listening") setVoiceStatus("listening");
            break;
          case "error":
            console.error("Voice error:", data.message);
            break;
        }
      };

      ws.onclose = () => {
        disconnect();
      };

      ws.onerror = () => {
        disconnect();
        setVoiceStatus("error");
        setTimeout(() => setVoiceStatus("idle"), 3000);
      };
    } catch (err) {
      console.error("Voice connection failed:", err);
      disconnect();
      setVoiceStatus("error");
      setTimeout(() => setVoiceStatus("idle"), 3000);
    }
  }, [playNextChunk]);

  const disconnect = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setVoiceStatus("idle");
    setPartialText("");
  }, []);

  const toggle = useCallback(() => {
    if (voiceStatus !== "idle" && voiceStatus !== "error") {
      disconnect();
    } else if (voiceStatus === "idle") {
      connect();
    }
  }, [voiceStatus, connect, disconnect]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { voiceStatus, partialText, lastResponse, toggle };
}

const voiceStatusLabels: Record<VoiceStatus, string> = {
  idle: "",
  connecting: "Подключение...",
  listening: "Слушаю...",
  thinking: "Думаю...",
  speaking: "Отвечаю...",
  error: "Ошибка связи",
};

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

  const { voiceStatus, partialText, lastResponse, toggle: toggleVoice } = useVoiceAgent();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  const isVoiceActive = voiceStatus !== "idle" && voiceStatus !== "error" && voiceStatus !== "connecting";

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

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
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !isVoiceActive && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-gray-400">
                <svg className="mx-auto mb-3 h-12 w-12" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
                <p className="text-sm font-medium">Задайте вопрос агенту</p>
                <p className="mt-1 text-xs">Агент ответит на основе базы знаний и прайс-листа</p>
              </div>
            </div>
          )}

          {/* Voice mode display */}
          {isVoiceActive && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              {/* Animated mic indicator */}
              <div className={`flex h-20 w-20 items-center justify-center rounded-full ${
                voiceStatus === "listening"
                  ? "bg-green-100"
                  : voiceStatus === "thinking"
                    ? "bg-yellow-100"
                    : voiceStatus === "speaking"
                      ? "bg-blue-100"
                      : "bg-gray-100"
              }`}>
                <div className={`flex h-14 w-14 items-center justify-center rounded-full ${
                  voiceStatus === "listening"
                    ? "bg-green-500 animate-pulse"
                    : voiceStatus === "thinking"
                      ? "bg-yellow-500 animate-spin"
                      : voiceStatus === "speaking"
                        ? "bg-blue-500 animate-pulse"
                        : "bg-gray-400"
                }`}>
                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                  </svg>
                </div>
              </div>

              <p className={`text-sm font-medium ${
                voiceStatus === "listening" ? "text-green-600" :
                voiceStatus === "thinking" ? "text-yellow-600" :
                voiceStatus === "speaking" ? "text-blue-600" :
                "text-gray-500"
              }`}>
                {voiceStatusLabels[voiceStatus]}
              </p>

              {/* Show partial transcription */}
              {partialText && (
                <div className="max-w-md rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-600 italic">
                  {partialText}
                </div>
              )}

              {/* Show last response */}
              {lastResponse && (
                <div className="max-w-lg rounded-xl bg-blue-50 px-4 py-3 text-sm text-gray-800">
                  <div className="prose prose-sm max-w-none">
                    <Markdown>{lastResponse}</Markdown>
                  </div>
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2">
                    <Markdown>{msg.content || "\u200B"}</Markdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {isStreaming && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-gray-100 px-4 py-3">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <form onSubmit={handleSubmit} className="border-t border-gray-200/60 px-4 py-3">
          <div className="flex items-end gap-2">
            {/* Microphone button */}
            <button
              type="button"
              onClick={toggleVoice}
              disabled={voiceStatus === "connecting"}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                isVoiceActive
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : voiceStatus === "connecting"
                    ? "bg-yellow-400 text-white cursor-wait"
                    : voiceStatus === "error"
                      ? "bg-red-200 text-red-600"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
              }`}
              title={isVoiceActive ? "Отключить голос" : "Включить голосового агента"}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
            </button>

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
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Right panel: Sources */}
      <div className="w-80 shrink-0 border-l border-gray-200/60 bg-gray-50/50 overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-200/60">
          <h3 className="text-sm font-semibold text-gray-700">Источники</h3>
        </div>
        <div className="px-4 py-3 space-y-2">
          {sources.length === 0 ? (
            <p className="text-xs text-gray-400">Источники появятся после ответа агента</p>
          ) : (
            sources.map((source, i) => (
              <SourceCard key={i} source={source} onClick={() => navigate(`/articles/${source.slug}`)} />
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
    scorePercent >= 80 ? "text-green-600 bg-green-50" :
    scorePercent >= 60 ? "text-yellow-600 bg-yellow-50" :
    "text-gray-600 bg-gray-100";

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
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${scoreColor}`}>
          {scorePercent}%
        </span>
      </div>
    </button>
  );
}
