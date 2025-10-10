import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { getAccessToken } from "../api/client";
import { Link } from "react-router-dom";

/* ─── Types ──────────────────────────────────────────────── */

interface SegmentResult {
  topic: string;
  urgency: string;
  action: string;
  article_slug: string;
  article_name: string;
  similarity?: number;
}

interface PipelineResult {
  transcript: string;
  segments: SegmentResult[];
  duration: string;
}

type Stage = "idle" | "uploading" | "transcribing" | "segmenting" | "classifying" | "done" | "error";

const STAGES: { key: Stage; label: string; icon: string; description: string }[] = [
  { key: "uploading",     label: "Загрузка",       icon: "upload",      description: "Отправляем аудио на сервер" },
  { key: "transcribing",  label: "Транскрипция",   icon: "waveform",    description: "Whisper распознаёт речь" },
  { key: "segmenting",    label: "Сегментация",    icon: "scissors",    description: "Разделяем на темы" },
  { key: "classifying",   label: "Классификация",  icon: "brain",       description: "Сопоставляем со статьями" },
];

/* ─── Batch Types ────────────────────────────────────────── */

type FileStatus = "pending" | "uploading" | "transcribing" | "segmenting" | "classifying" | "done" | "error";

interface FileJob {
  id: string;
  file: File;
  status: FileStatus;
  result?: PipelineResult;
  error?: string;
}

type BatchMode = "select" | "processing" | "done";

const MAX_FILES = 20;
const MAX_CONCURRENCY = 5;

/* ─── Helpers ────────────────────────────────────────────── */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ─── Component ──────────────────────────────────────────── */

export function PipelinePage() {
  const { user } = useAuth();

  // Single-file mode state
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Batch mode state
  const [files, setFiles] = useState<FileJob[]>([]);
  const [batchMode, setBatchMode] = useState<BatchMode | null>(null);
  const [wasTrimmed, setWasTrimmed] = useState(false);

  const canUse = user?.role === "admin" || user?.role === "superadmin";

  // Simulated stage progression (single-file)
  const startStageSimulation = useCallback(() => {
    const sequence: Stage[] = ["uploading", "transcribing", "segmenting", "classifying"];
    let idx = 0;
    setStage(sequence[0]);

    stageTimerRef.current = setInterval(() => {
      idx++;
      if (idx < sequence.length) {
        setStage(sequence[idx]);
      } else {
        if (stageTimerRef.current) clearInterval(stageTimerRef.current);
      }
    }, 4000);
  }, []);

  const stopSimulation = useCallback(() => {
    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopSimulation(), [stopSimulation]);

  // Single file processing
  const processSingleFile = useCallback(
    async (file: File) => {
      setError(null);
      setResult(null);
      setFileName(file.name);
      startStageSimulation();

      try {
        const form = new FormData();
        form.append("audio", file);

        const resp = await fetch("/api/pipeline/process", {
          method: "POST",
          headers: { Authorization: `Bearer ${getAccessToken()}` },
          body: form,
        });

        stopSimulation();

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(body.error || `HTTP ${resp.status}`);
        }

        const data: PipelineResult = await resp.json();
        setResult(data);
        setStage("done");
      } catch (e: any) {
        stopSimulation();
        setError(e.message || "Pipeline failed");
        setStage("error");
      }
    },
    [startStageSimulation, stopSimulation]
  );

  // Handle file selection (single or batch)
  const handleFiles = useCallback(
    (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      if (selectedFiles.length === 1) {
        processSingleFile(selectedFiles[0]);
        return;
      }

      // Batch mode
      setWasTrimmed(selectedFiles.length > MAX_FILES);
      const trimmed = selectedFiles.slice(0, MAX_FILES);
      const jobs: FileJob[] = trimmed.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "pending" as FileStatus,
      }));
      setFiles(jobs);
      setBatchMode("select");
    },
    [processSingleFile]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(Array.from(e.dataTransfer.files));
    },
    [handleFiles]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(Array.from(e.target.files || []));
    },
    [handleFiles]
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (next.length === 0) setBatchMode(null);
      return next;
    });
  }, []);

  // Batch processing with concurrency limit
  const processAll = useCallback(async () => {
    setBatchMode("processing");

    const updateJob = (id: string, update: Partial<FileJob>) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...update } : f)));
    };

    const processOneFile = async (job: FileJob) => {
      const stages: FileStatus[] = ["uploading", "transcribing", "segmenting", "classifying"];
      let stageIdx = 0;
      updateJob(job.id, { status: stages[0] });

      const timer = setInterval(() => {
        stageIdx++;
        if (stageIdx < stages.length) {
          updateJob(job.id, { status: stages[stageIdx] });
        } else {
          clearInterval(timer);
        }
      }, 4000);

      try {
        const form = new FormData();
        form.append("audio", job.file);

        const resp = await fetch("/api/pipeline/process", {
          method: "POST",
          headers: { Authorization: `Bearer ${getAccessToken()}` },
          body: form,
        });

        clearInterval(timer);

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(body.error || `HTTP ${resp.status}`);
        }

        const data: PipelineResult = await resp.json();
        updateJob(job.id, { status: "done", result: data });
      } catch (e: any) {
        clearInterval(timer);
        updateJob(job.id, { status: "error", error: e.message || "Pipeline failed" });
      }
    };

    // Semaphore: N workers pulling from a shared queue
    const queue = [...files];
    const runNext = async (): Promise<void> => {
      const job = queue.shift();
      if (!job) return;
      await processOneFile(job);
      await runNext();
    };

    const workers = Math.min(MAX_CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: workers }, () => runNext()));

    setBatchMode("done");
  }, [files]);

  const reset = () => {
    setStage("idle");
    setResult(null);
    setError(null);
    setFileName(null);
    setFiles([]);
    setBatchMode(null);
    setWasTrimmed(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (!canUse) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-5xl mb-4">&#128274;</div>
        <h2 className="text-lg font-semibold text-gray-900">Нет доступа</h2>
        <p className="mt-1 text-sm text-gray-500">Pipeline доступен только администраторам</p>
      </div>
    );
  }

  const isProcessing = !["idle", "done", "error"].includes(stage);
  const isIdle = stage === "idle" && batchMode === null;

  return (
    <div className="space-y-8">
      {/* Upload zone */}
      {isIdle && (
        <UploadZone
          dragOver={dragOver}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onFileSelect={onFileSelect}
          fileRef={fileRef}
        />
      )}

      {/* Batch: File list (select mode) */}
      {batchMode === "select" && (
        <FileList
          files={files}
          wasTrimmed={wasTrimmed}
          onRemove={removeFile}
          onProcessAll={processAll}
          onCancel={reset}
        />
      )}

      {/* Batch: Processing progress */}
      {batchMode === "processing" && <BatchProgress files={files} />}

      {/* Batch: Results */}
      {batchMode === "done" && <BatchResults files={files} onReset={reset} />}

      {/* Single-file: Processing animation */}
      {batchMode === null && isProcessing && (
        <ProcessingAnimation stage={stage} fileName={fileName} />
      )}

      {/* Single-file: Error */}
      {batchMode === null && stage === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-red-500">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-red-800">Ошибка обработки</h3>
              <p className="mt-1 text-sm text-red-600">{error}</p>
            </div>
          </div>
          <button onClick={reset} className="mt-4 rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-200">
            Попробовать снова
          </button>
        </div>
      )}

      {/* Single-file: Results */}
      {batchMode === null && stage === "done" && result && (
        <ResultsView result={result} onReset={reset} />
      )}
    </div>
  );
}

/* ─── Upload Zone ────────────────────────────────────────── */

function UploadZone({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
  fileRef,
}: {
  dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => fileRef.current?.click()}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-300 ${
        dragOver
          ? "border-blue-400 bg-blue-50/80 shadow-lg shadow-blue-100"
          : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-md"
      }`}
    >
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
        multiple
        onChange={onFileSelect}
        className="hidden"
      />

      <div className="flex flex-col items-center py-16 px-6">
        {/* Animated mic icon */}
        <div className={`relative mb-6 flex h-20 w-20 items-center justify-center rounded-2xl transition-all duration-300 ${
          dragOver ? "bg-blue-100 scale-110" : "bg-gray-100 group-hover:bg-blue-50 group-hover:scale-105"
        }`}>
          <svg className={`h-10 w-10 transition-colors duration-300 ${dragOver ? "text-blue-600" : "text-gray-400 group-hover:text-blue-500"}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
          </svg>
          {/* Pulse rings */}
          <div className={`absolute inset-0 rounded-2xl border-2 transition-opacity duration-300 ${dragOver ? "animate-ping border-blue-300 opacity-75" : "opacity-0"}`} />
        </div>

        <h3 className="text-lg font-semibold text-gray-900">
          {dragOver ? "Отпустите файлы" : "Загрузите записи звонков"}
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          Перетащите аудио файлы или нажмите для выбора
        </p>
        <p className="mt-1 text-xs text-gray-400">
          MP3, WAV, OGG, M4A, FLAC &middot; до {MAX_FILES} файлов за раз
        </p>
      </div>
    </div>
  );
}

/* ─── File List (batch select mode) ─────────────────────── */

function FileList({
  files,
  wasTrimmed,
  onRemove,
  onProcessAll,
  onCancel,
}: {
  files: FileJob[];
  wasTrimmed: boolean;
  onRemove: (id: string) => void;
  onProcessAll: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">
            Выбрано файлов: {files.length}
          </h3>
          {wasTrimmed && (
            <p className="text-xs text-amber-600 mt-1">
              Максимум {MAX_FILES} файлов. Лишние были отброшены.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            onClick={onProcessAll}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Обработать все
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {files.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <svg className="h-5 w-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
              </svg>
              <span className="text-sm font-medium text-gray-700 truncate">{f.file.name}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">{formatFileSize(f.file.size)}</span>
            </div>
            <button
              onClick={() => onRemove(f.id)}
              className="ml-3 flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Batch Progress ─────────────────────────────────────── */

function BatchProgress({ files }: { files: FileJob[] }) {
  const completed = files.filter((f) => f.status === "done" || f.status === "error").length;
  const progressPct = files.length > 0 ? (completed / files.length) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Обработка файлов</h3>
          <span className="text-sm text-gray-500">{completed} / {files.length}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Per-file cards */}
      <div className="space-y-2">
        {files.map((f) => (
          <BatchFileCard key={f.id} job={f} />
        ))}
      </div>
    </div>
  );
}

function BatchFileCard({ job }: { job: FileJob }) {
  const statusConfig: Record<FileStatus, { color: string; bg: string; icon: "clock" | "spinner" | "check" | "x"; label: string }> = {
    pending:       { color: "text-gray-400",  bg: "bg-gray-50",  icon: "clock",   label: "В очереди" },
    uploading:     { color: "text-blue-600",  bg: "bg-blue-50",  icon: "spinner", label: "Загрузка" },
    transcribing:  { color: "text-blue-600",  bg: "bg-blue-50",  icon: "spinner", label: "Транскрипция" },
    segmenting:    { color: "text-blue-600",  bg: "bg-blue-50",  icon: "spinner", label: "Сегментация" },
    classifying:   { color: "text-blue-600",  bg: "bg-blue-50",  icon: "spinner", label: "Классификация" },
    done:          { color: "text-green-600", bg: "bg-green-50", icon: "check",   label: "Готово" },
    error:         { color: "text-red-600",   bg: "bg-red-50",   icon: "x",       label: "Ошибка" },
  };
  const cfg = statusConfig[job.status];
  const isActive = !["pending", "done", "error"].includes(job.status);

  let summary = "";
  if (job.status === "done" && job.result) {
    const segs = job.result.segments.length;
    const created = job.result.segments.filter((s) => s.action === "created").length;
    const enriched = job.result.segments.filter((s) => s.action === "enriched").length;
    summary = `${segs} сегм., ${created} создано, ${enriched} обогащено`;
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl border border-gray-200/80 px-4 py-3 ${cfg.bg} transition-all duration-300`}>
      {/* Status icon */}
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0 ${cfg.color}`}>
        {cfg.icon === "clock" && (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        )}
        {cfg.icon === "spinner" && (
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {cfg.icon === "check" && (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        )}
        {cfg.icon === "x" && (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        )}
      </div>

      {/* File info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{job.file.name}</span>
          {isActive && (
            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          )}
        </div>
        {job.status === "done" && summary && (
          <p className="text-xs text-green-600 mt-0.5">{summary}</p>
        )}
        {job.status === "error" && job.error && (
          <p className="text-xs text-red-600 mt-0.5 truncate">{job.error}</p>
        )}
      </div>

      {/* Static badge for terminal states */}
      {!isActive && (
        <span className={`flex-shrink-0 text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
      )}
    </div>
  );
}

/* ─── Batch Results ──────────────────────────────────────── */

function BatchResults({ files, onReset }: { files: FileJob[]; onReset: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const doneFiles = files.filter((f) => f.status === "done" && f.result);
  const errorFiles = files.filter((f) => f.status === "error");

  const totalSegments = doneFiles.reduce((sum, f) => sum + (f.result?.segments.length ?? 0), 0);
  const totalCreated = doneFiles.reduce(
    (sum, f) => sum + (f.result?.segments.filter((s) => s.action === "created").length ?? 0),
    0,
  );
  const totalEnriched = doneFiles.reduce(
    (sum, f) => sum + (f.result?.segments.filter((s) => s.action === "enriched").length ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      {/* Aggregate stats */}
      <div className={`grid grid-cols-2 gap-4 ${errorFiles.length > 0 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        <StatCard label="Файлов" value={String(files.length)} color="blue" />
        <StatCard label="Сегментов" value={String(totalSegments)} color="purple" />
        <StatCard label="Создано" value={String(totalCreated)} color="amber" />
        <StatCard label="Обогащено" value={String(totalEnriched)} color="green" />
        {errorFiles.length > 0 && (
          <StatCard label="Ошибок" value={String(errorFiles.length)} color="red" />
        )}
      </div>

      {/* Expandable per-file results */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Результаты по файлам
        </h3>
        {files.map((f) => (
          <div key={f.id} className="rounded-xl border border-gray-200/80 bg-white shadow-sm overflow-hidden">
            <button
              onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
              className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                {f.status === "done" ? (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-50 text-green-600 flex-shrink-0">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </div>
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50 text-red-600 flex-shrink-0">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </div>
                )}
                <span className="text-sm font-medium text-gray-900 truncate">{f.file.name}</span>
                {f.status === "done" && f.result && (
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {f.result.segments.length} сегм.
                  </span>
                )}
                {f.status === "error" && (
                  <span className="text-xs text-red-500 truncate">{f.error}</span>
                )}
              </div>
              <svg
                className={`h-5 w-5 text-gray-400 transition-transform duration-200 flex-shrink-0 ml-2 ${
                  expandedId === f.id ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {expandedId === f.id && f.status === "done" && f.result && (
              <div className="border-t border-gray-100 px-5 py-4">
                <ResultsView result={f.result} onReset={() => {}} hideActions />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          Загрузить ещё
        </button>
        <Link
          to="/articles"
          className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
        >
          К базе знаний
        </Link>
      </div>
    </div>
  );
}

/* ─── Processing Animation (single-file) ────────────────── */

function ProcessingAnimation({ stage, fileName }: { stage: Stage; fileName: string | null }) {
  const currentIdx = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-sm">
      {/* File name */}
      {fileName && (
        <div className="mb-8 flex items-center justify-center gap-2 text-sm text-gray-500">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
          </svg>
          <span className="truncate max-w-xs">{fileName}</span>
        </div>
      )}

      {/* Stage pipeline visualization */}
      <div className="relative flex items-start justify-between">
        {/* Connecting line */}
        <div className="absolute top-7 left-[10%] right-[10%] h-0.5 bg-gray-100">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-1000 ease-out"
            style={{ width: `${Math.max(0, (currentIdx / (STAGES.length - 1)) * 100)}%` }}
          />
        </div>

        {STAGES.map((s, i) => {
          const isActive = s.key === stage;
          const isDone = i < currentIdx;
          return (
            <div key={s.key} className="relative z-10 flex w-1/4 flex-col items-center">
              <StageIcon icon={s.icon} isActive={isActive} isDone={isDone} />
              <span className={`mt-3 text-sm font-medium transition-colors duration-300 ${
                isActive ? "text-blue-700" : isDone ? "text-green-600" : "text-gray-400"
              }`}>
                {s.label}
              </span>
              {isActive && (
                <span className="mt-1 text-xs text-blue-500 animate-pulse">
                  {s.description}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Waveform animation */}
      <div className="mt-10 flex items-center justify-center gap-[3px]">
        {Array.from({ length: 40 }).map((_, i) => (
          <WaveBar key={i} index={i} stage={stage} />
        ))}
      </div>
    </div>
  );
}

/* ─── Stage Icon ─────────────────────────────────────────── */

function StageIcon({ icon, isActive, isDone }: { icon: string; isActive: boolean; isDone: boolean }) {
  const base = "flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-500";
  const classes = isDone
    ? `${base} bg-green-50 text-green-500 scale-100`
    : isActive
    ? `${base} bg-blue-100 text-blue-600 scale-110 shadow-lg shadow-blue-100`
    : `${base} bg-gray-50 text-gray-300 scale-100`;

  return (
    <div className={classes}>
      {isDone ? (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      ) : (
        <>
          {icon === "upload" && (
            <svg className={`h-7 w-7 ${isActive ? "animate-bounce" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
          )}
          {icon === "waveform" && (
            <svg className={`h-7 w-7 ${isActive ? "animate-pulse" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          )}
          {icon === "scissors" && (
            <svg className={`h-7 w-7 ${isActive ? "animate-pulse" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m7.848 8.25 1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083-.793L14.25 7.5l-1.534.886Zm0 0L6.75 12m7.848-3.75 1.536-.887M14.598 8.25a3 3 0 1 0 5.196-3 3 3 0 0 0-5.196 3Zm1.536-.887a2.165 2.165 0 0 0-1.083-.793L10.5 7.5l1.534.886Zm0 0L18 12m-7.5 0h7.5m-7.5 0-4.5 6m4.5-6 4.5 6m-9-1.5h.008v.008H6.75v-.008Zm9 0h.008v.008h-.008v-.008Z" />
            </svg>
          )}
          {icon === "brain" && (
            <svg className={`h-7 w-7 ${isActive ? "animate-spin-slow" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
            </svg>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Waveform Bar ───────────────────────────────────────── */

function WaveBar({ index, stage }: { index: number; stage: Stage }) {
  const [height, setHeight] = useState(4);

  useEffect(() => {
    const interval = setInterval(() => {
      const base = stage === "transcribing" ? 28 : stage === "segmenting" ? 18 : 12;
      const variance = stage === "transcribing" ? 24 : stage === "segmenting" ? 14 : 8;
      setHeight(base + Math.random() * variance - variance / 2);
    }, 120 + index * 8);
    return () => clearInterval(interval);
  }, [index, stage]);

  const color = stage === "transcribing"
    ? "bg-blue-400"
    : stage === "segmenting"
    ? "bg-purple-400"
    : stage === "classifying"
    ? "bg-green-400"
    : "bg-gray-300";

  return (
    <div
      className={`w-1 rounded-full transition-all duration-150 ${color}`}
      style={{ height: `${height}px` }}
    />
  );
}

/* ─── Results View ───────────────────────────────────────── */

function ResultsView({
  result,
  onReset,
  hideActions = false,
}: {
  result: PipelineResult;
  onReset: () => void;
  hideActions?: boolean;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const enriched = result.segments.filter((s) => s.action === "enriched").length;
  const created = result.segments.filter((s) => s.action === "created").length;
  const failed = result.segments.filter((s) => s.action.includes("failed")).length;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Время" value={result.duration} color="blue" />
        <StatCard label="Сегментов" value={String(result.segments.length)} color="purple" />
        <StatCard label="Обогащено" value={String(enriched)} color="green" />
        <StatCard label="Создано" value={String(created)} color="amber" />
      </div>

      {/* Transcript toggle */}
      <div className="rounded-xl border border-gray-200/80 bg-white shadow-sm">
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <span className="font-medium text-gray-900">Транскрипт</span>
          </div>
          <svg className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${showTranscript ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {showTranscript && (
          <div className="border-t border-gray-100 px-6 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{result.transcript}</p>
          </div>
        )}
      </div>

      {/* Segments */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Обработанные сегменты</h3>
        {result.segments.map((seg, i) => (
          <SegmentCard key={i} segment={seg} index={i} />
        ))}
      </div>

      {/* Failed segments warning */}
      {failed > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4">
          <p className="text-sm text-amber-700">
            {failed} {failed === 1 ? "сегмент не удалось обработать" : "сегментов не удалось обработать"}. Попробуйте загрузить файл снова.
          </p>
        </div>
      )}

      {/* Actions */}
      {!hideActions && (
        <div className="flex gap-3">
          <button onClick={onReset} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700">
            Загрузить ещё
          </button>
          <Link to="/articles" className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50">
            К базе знаний
          </Link>
        </div>
      )}
    </div>
  );
}

/* ─── Stat Card ──────────────────────────────────────────── */

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue:   "bg-blue-50 text-blue-700",
    purple: "bg-purple-50 text-purple-700",
    green:  "bg-green-50 text-green-700",
    amber:  "bg-amber-50 text-amber-700",
    red:    "bg-red-50 text-red-700",
  };
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colors[color]?.split(" ")[1] || "text-gray-900"}`}>{value}</p>
    </div>
  );
}

/* ─── Segment Card ───────────────────────────────────────── */

function SegmentCard({ segment, index }: { segment: SegmentResult; index: number }) {
  const isFailed = segment.action.includes("failed");
  const isCreated = segment.action === "created";
  const isEnriched = segment.action === "enriched";

  const actionBadge = isFailed
    ? { bg: "bg-red-50", text: "text-red-700", label: "Ошибка" }
    : isCreated
    ? { bg: "bg-amber-50", text: "text-amber-700", label: "Создана" }
    : isEnriched
    ? { bg: "bg-green-50", text: "text-green-700", label: "Обогащена" }
    : { bg: "bg-gray-50", text: "text-gray-600", label: segment.action };

  const urgencyBadge: Record<string, { bg: string; text: string; label: string }> = {
    emergency:     { bg: "bg-red-50",    text: "text-red-700",    label: "Экстренно" },
    urgent:        { bg: "bg-orange-50", text: "text-orange-700", label: "Срочно" },
    routine:       { bg: "bg-blue-50",   text: "text-blue-700",   label: "Рутина" },
    informational: { bg: "bg-gray-50",   text: "text-gray-600",   label: "Инфо" },
  };
  const urg = urgencyBadge[segment.urgency] || urgencyBadge.informational;

  return (
    <div
      className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-900">{segment.topic}</h4>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${actionBadge.bg} ${actionBadge.text}`}>
              {actionBadge.label}
            </span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${urg.bg} ${urg.text}`}>
              {urg.label}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-sm text-gray-500">
            <Link
              to={`/articles/${segment.article_slug}`}
              className="text-blue-600 hover:text-blue-700 hover:underline"
            >
              {segment.article_name}
            </Link>
            {segment.similarity != null && segment.similarity > 0 && (
              <span className="text-gray-400">
                {(segment.similarity * 100).toFixed(0)}% match
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
