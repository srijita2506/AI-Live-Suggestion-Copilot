"use client";

import { Download, Mic, RefreshCcw, Send, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";

type TranscriptEntry = {
  id: string;
  createdAt: string;
  timestamp: string;
  text: string;
  pending?: boolean;
  error?: boolean;
};

type SuggestionType =
  | "QUESTION TO ASK"
  | "TALKING POINT"
  | "FACT-CHECK"
  | "ANSWER"
  | "CLARIFYING INFO";

type Suggestion = {
  id: string;
  batchId: string;
  batchNumber: number;
  createdAt: string;
  timestamp: string;
  type: SuggestionType;
  text: string;
};

type SuggestionBatch = {
  id: string;
  batchNumber: number;
  createdAt: string;
  timestamp: string;
  suggestions: Suggestion[];
};

type SuggestionApiItem = {
  type: SuggestionType;
  text: string;
};

type ChatMessageData = {
  id: string;
  createdAt: string;
  timestamp: string;
  role: "user" | "assistant";
  label?: string;
  content: string;
  pending?: boolean;
  error?: boolean;
  mode: "detail" | "chat";
};

type SettingsState = {
  groqApiKey: string;
  transcriptionModel: string;
  reasoningModel: string;
  language: string;
  refreshIntervalSeconds: number;
  suggestionContextEntries: number;
  detailContextEntries: number;
  chatContextEntries: number;
  liveSuggestionPrompt: string;
  detailAnswerPrompt: string;
  chatPrompt: string;
};

const SETTINGS_STORAGE_KEY = "tm_settings_v2";

const DEFAULT_SETTINGS: SettingsState = {
  groqApiKey: "",
  transcriptionModel: "whisper-large-v3",
  reasoningModel: "openai/gpt-oss-120b",
  language: "en",
  refreshIntervalSeconds: 30,
  suggestionContextEntries: 6,
  detailContextEntries: 12,
  chatContextEntries: 16,
  liveSuggestionPrompt:
    [
      "You are TwinMind, an always-on AI meeting copilot.",
      "You will receive the most recent transcript window from a live conversation.",
      "Return exactly 3 fresh suggestions that are useful right now.",
      "Choose the most relevant mix from these categories: QUESTION TO ASK, TALKING POINT, FACT-CHECK, ANSWER, CLARIFYING INFO.",
      "Prioritize timing and usefulness over generic advice.",
      "The preview text must already provide value even if the user never clicks it.",
      "Keep each preview concise, specific, and under 160 characters.",
      "Avoid repeating the same idea across the 3 suggestions.",
      "Use only what is supported by the transcript. If context is thin, make the best grounded suggestions you can.",
      'Respond with JSON only as an array of exactly 3 objects in the shape [{"type":"QUESTION TO ASK","text":"..."}].',
    ].join("\n"),
  detailAnswerPrompt:
    [
      "You are TwinMind, a live meeting copilot.",
      "The user clicked one live suggestion and wants a more detailed answer.",
      "Use the supplied transcript context first. Stay concrete, practical, and easy to act on immediately.",
      "If the transcript is insufficient, say what is missing and give the best bounded guidance you can.",
      "Structure the answer so it helps the user in the current conversation, not as a generic essay.",
      "Prefer this format when it fits: a short direct answer, then a few bullets, and a short takeaway or next step.",
      "Use markdown-style headings, bullets, numbered lists, and simple tables when they make the answer easier to scan.",
    ].join("\n"),
  chatPrompt:
    [
      "You are TwinMind, a live meeting copilot answering a direct user question during an active conversation.",
      "Answer using the supplied transcript context first.",
      "Be concise but complete, surface assumptions clearly, and avoid inventing facts that are not grounded in the meeting.",
      "When helpful, offer a short next step, phrasing suggestion, or follow-up question the user can use immediately.",
      "Format answers cleanly for a chat UI: use short sections, bullets, numbered lists, and simple markdown-style tables where useful.",
      "Avoid giant walls of text. Prefer scannable structure.",
    ].join("\n"),
};

const badgeClasses: Record<SuggestionType, string> = {
  "QUESTION TO ASK": "text-sky-300 bg-sky-500/10 border-sky-400/20",
  "TALKING POINT": "text-violet-300 bg-violet-500/10 border-violet-400/20",
  "FACT-CHECK": "text-amber-300 bg-amber-500/10 border-amber-400/20",
  ANSWER: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
  "CLARIFYING INFO": "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-400/20",
};

function createId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getTimeParts(date = new Date()) {
  return {
    createdAt: date.toISOString(),
    timestamp: date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

function coercePositiveInteger(value: unknown, fallback: number) {
  const next = Number(value);

  if (!Number.isFinite(next)) {
    return fallback;
  }

  return Math.max(1, Math.round(next));
}

function buildContext(transcript: TranscriptEntry[], entries: number) {
  return transcript
    .filter((entry) => !entry.pending && !entry.error)
    .slice(-entries)
    .map((entry) => `[${entry.timestamp}] ${entry.text}`)
    .join("\n");
}

function Header({
  title,
  status,
}: {
  title: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-100">
        {title}
      </h2>
      <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
        {status}
      </span>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-950/50 p-6">
      <p className="text-sm font-semibold text-zinc-100">{title}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
    </div>
  );
}

function TranscriptItem({ entry }: { entry: TranscriptEntry }) {
  return (
    <div className="relative">
      {entry.pending ? (
        <div className="absolute right-4 top-4 h-2 w-2 rounded-full bg-sky-400" />
      ) : null}
      <div
        className={`rounded-2xl border px-4 py-3 ${
          entry.error
            ? "border-rose-500/30 bg-rose-500/5"
            : "border-zinc-800 bg-zinc-950/70"
        }`}
      >
        <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          {entry.timestamp}
        </div>
        <p
          className={`text-sm leading-6 ${
            entry.pending
              ? "text-zinc-400"
              : entry.error
                ? "text-rose-200"
                : "text-zinc-200"
          }`}
        >
          {entry.text}
        </p>
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onSelect,
}: {
  suggestion: Suggestion;
  onSelect: (suggestion: Suggestion) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(suggestion)}
      className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-left transition hover:border-zinc-700"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div
          className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${badgeClasses[suggestion.type]}`}
        >
          {suggestion.type}
        </div>
        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          {suggestion.timestamp}
        </span>
      </div>
      <p className="text-sm font-semibold leading-6 text-zinc-100">
        {suggestion.text}
      </p>
    </button>
  );
}

function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.role === "user";
  const blocks = message.content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  function renderInline(text: string) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);

    return parts.map((part, index) => {
      const isBold = part.startsWith("**") && part.endsWith("**") && part.length > 4;

      if (isBold) {
        return (
          <strong key={`inline-${index}`} className="font-semibold text-zinc-50">
            {part.slice(2, -2)}
          </strong>
        );
      }

      return <span key={`inline-${index}`}>{part}</span>;
    });
  }

  return (
    <div
      className={`rounded-2xl border p-4 ${isUser ? "border-zinc-700 bg-zinc-900/90" : "border-zinc-800 bg-zinc-950/80"}`}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        <span>
          {isUser ? `YOU${message.label ? ` - ${message.label}` : ""}` : "ASSISTANT"}
        </span>
        <span>{message.timestamp}</span>
      </div>
      <div
        className={`space-y-3 text-sm leading-6 ${
          message.pending
            ? "text-zinc-400"
            : message.error
              ? "text-rose-200"
              : "text-zinc-200"
        }`}
      >
        {(blocks.length > 0 ? blocks : [message.content]).map((block, index) => {
          const lines = block
            .split("\n")
            .map((line) => line.trimEnd())
            .filter(Boolean);

          if (lines.length === 1 && /^---+$/.test(lines[0])) {
            return (
              <div
                key={`${message.id}-divider-${index}`}
                className="h-px bg-zinc-800"
              />
            );
          }

          const titleMatch = lines.length === 1
            ? lines[0].match(/^#{1,6}\s+(.+)$/)
            : null;

          if (titleMatch) {
            return (
              <h4
                key={`${message.id}-title-${index}`}
                className="text-sm font-semibold text-zinc-50"
              >
                {renderInline(titleMatch[1])}
              </h4>
            );
          }

          const boldTitleMatch = lines.length === 1
            ? lines[0].match(/^\*\*(.+)\*\*:?\s*$/)
            : null;

          if (boldTitleMatch) {
            return (
              <h4
                key={`${message.id}-bold-title-${index}`}
                className="text-sm font-semibold text-zinc-50"
              >
                {boldTitleMatch[1]}
              </h4>
            );
          }

          const tableLines = lines.filter((line) => line.includes("|"));
          if (tableLines.length >= 2) {
            const rows = tableLines
              .map((line) =>
                line
                  .split("|")
                  .map((cell) => cell.trim())
                  .filter(Boolean),
              )
              .filter((row) => row.length > 0)
              .filter(
                (row) =>
                  !row.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, ""))),
              );

            if (rows.length >= 2) {
              const [headerRow, ...bodyRows] = rows;

              return (
                <div
                  key={`${message.id}-table-${index}`}
                  className="overflow-x-auto rounded-2xl border border-zinc-800"
                >
                  <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
                    <thead className="bg-zinc-900/80 text-zinc-100">
                      <tr>
                        {headerRow.map((cell, cellIndex) => (
                          <th
                            key={`${message.id}-th-${index}-${cellIndex}`}
                            className="border-b border-zinc-800 px-3 py-2 font-semibold"
                          >
                            {renderInline(cell)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bodyRows.map((row, rowIndex) => (
                        <tr
                          key={`${message.id}-row-${index}-${rowIndex}`}
                          className="border-t border-zinc-800/80"
                        >
                          {headerRow.map((_, cellIndex) => (
                            <td
                              key={`${message.id}-td-${index}-${rowIndex}-${cellIndex}`}
                              className="px-3 py-2 align-top"
                            >
                              {renderInline(row[cellIndex] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
          }

          const isBulletBlock =
            lines.length > 0 &&
            lines.every((line) => /^([-*]|\d+\.)\s+/.test(line));

          if (isBulletBlock) {
            const isNumbered = lines.every((line) => /^\d+\.\s+/.test(line));

            const ListTag = isNumbered ? "ol" : "ul";
            const listClassName = isNumbered
              ? "ml-5 list-decimal space-y-2"
              : "ml-5 list-disc space-y-2";

            return (
              <ListTag
                key={`${message.id}-list-${index}`}
                className={listClassName}
              >
                {lines.map((line, lineIndex) => (
                  <li
                    key={`${message.id}-line-${index}-${lineIndex}`}
                    className="pl-1"
                  >
                    {renderInline(line.replace(/^([-*]|\d+\.)\s+/, ""))}
                  </li>
                ))}
              </ListTag>
            );
          }

          const keyValueLines =
            lines.length > 1 &&
            lines.every((line) => /^[^:]{1,40}:\s+.+$/.test(line));

          if (keyValueLines) {
            return (
              <div
                key={`${message.id}-kv-${index}`}
                className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3"
              >
                {lines.map((line, lineIndex) => {
                  const [label, ...rest] = line.split(":");
                  const value = rest.join(":").trim();

                  return (
                    <div
                      key={`${message.id}-kv-line-${index}-${lineIndex}`}
                      className="grid gap-1 sm:grid-cols-[160px_1fr]"
                    >
                      <div className="font-semibold text-zinc-100">
                        {renderInline(label)}
                      </div>
                      <div>{renderInline(value)}</div>
                    </div>
                  );
                })}
              </div>
            );
          }

          const singleLine = lines.join(" ");
          const isHeading =
            singleLine.length > 0 &&
            singleLine.length <= 80 &&
            !singleLine.endsWith(".") &&
            !singleLine.endsWith("?") &&
            !singleLine.endsWith("!") &&
            !singleLine.startsWith("- ") &&
            !singleLine.startsWith("* ");

          if (isHeading) {
            return (
              <h4
                key={`${message.id}-block-${index}`}
                className="text-sm font-semibold text-zinc-100"
              >
                {renderInline(singleLine.replace(/^#+\s*/, ""))}
              </h4>
            );
          }

          return (
            <p
              key={`${message.id}-block-${index}`}
              className="whitespace-pre-wrap"
            >
              {lines.map((line, lineIndex) => (
                <span key={`${message.id}-text-${index}-${lineIndex}`}>
                  {renderInline(line)}
                  {lineIndex < lines.length - 1 ? "\n" : null}
                </span>
              ))}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function ColumnShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col border-l border-zinc-900 first:border-l-0">
      {children}
    </section>
  );
}

function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
        {label}
      </span>
      {children}
      {hint ? <p className="mt-2 text-xs leading-5 text-zinc-500">{hint}</p> : null}
    </label>
  );
}

function SettingsModal({
  onClose,
  onSettingsChange,
  open,
  settings,
}: {
  onClose: () => void;
  onSettingsChange: <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K],
  ) => void;
  open: boolean;
  settings: SettingsState;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-zinc-100">
              Session Settings
            </h3>
            <p className="mt-2 text-sm text-zinc-500">
              Stored locally in your browser. These prompts and windows drive the live experience.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-800 p-2 text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label="Groq API Key">
            <input
              type="password"
              value={settings.groqApiKey}
              onChange={(event) => onSettingsChange("groqApiKey", event.target.value)}
              placeholder="gsk_..."
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField
            label="Reasoning Model"
            hint="Required assignment default: openai/gpt-oss-120b"
          >
            <input
              type="text"
              value={settings.reasoningModel}
              onChange={(event) =>
                onSettingsChange("reasoningModel", event.target.value)
              }
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField
            label="Transcription Model"
            hint="Required assignment default: whisper-large-v3"
          >
            <input
              type="text"
              value={settings.transcriptionModel}
              onChange={(event) =>
                onSettingsChange("transcriptionModel", event.target.value)
              }
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField label="Language">
            <input
              type="text"
              value={settings.language}
              onChange={(event) => onSettingsChange("language", event.target.value)}
              placeholder="en"
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField label="Refresh Interval (seconds)">
            <input
              type="number"
              min={10}
              step={1}
              value={settings.refreshIntervalSeconds}
              onChange={(event) =>
                onSettingsChange(
                  "refreshIntervalSeconds",
                  coercePositiveInteger(event.target.value, 30),
                )
              }
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField label="Live Suggestion Context Entries">
            <input
              type="number"
              min={1}
              step={1}
              value={settings.suggestionContextEntries}
              onChange={(event) =>
                onSettingsChange(
                  "suggestionContextEntries",
                  coercePositiveInteger(event.target.value, 6),
                )
              }
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField label="Expanded Answer Context Entries">
            <input
              type="number"
              min={1}
              step={1}
              value={settings.detailContextEntries}
              onChange={(event) =>
                onSettingsChange(
                  "detailContextEntries",
                  coercePositiveInteger(event.target.value, 12),
                )
              }
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField label="Chat Context Entries">
            <input
              type="number"
              min={1}
              step={1}
              value={settings.chatContextEntries}
              onChange={(event) =>
                onSettingsChange(
                  "chatContextEntries",
                  coercePositiveInteger(event.target.value, 16),
                )
              }
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>
        </div>

        <div className="mt-4 space-y-4">
          <SettingsField label="Live Suggestions Prompt">
            <textarea
              value={settings.liveSuggestionPrompt}
              onChange={(event) =>
                onSettingsChange("liveSuggestionPrompt", event.target.value)
              }
              rows={8}
              className="w-full rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField label="Detailed Answer Prompt">
            <textarea
              value={settings.detailAnswerPrompt}
              onChange={(event) =>
                onSettingsChange("detailAnswerPrompt", event.target.value)
              }
              rows={6}
              className="w-full rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>

          <SettingsField label="Chat Prompt">
            <textarea
              value={settings.chatPrompt}
              onChange={(event) => onSettingsChange("chatPrompt", event.target.value)}
              rows={6}
              className="w-full rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none transition focus:border-sky-400/40"
            />
          </SettingsField>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([]);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(
    DEFAULT_SETTINGS.refreshIntervalSeconds,
  );
  const [pendingTranscriptions, setPendingTranscriptions] = useState(0);

  const transcriptRef = useRef(transcript);
  const settingsRef = useRef(settings);
  const refreshInFlightRef = useRef(false);
  const lastAutoSuggestionKeyRef = useRef("");
  const pendingTranscriptionsRef = useRef(0);
  const transcriptionWaitersRef = useRef<Array<() => void>>([]);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const updatePendingTranscriptions = (next: number) => {
    pendingTranscriptionsRef.current = next;
    setPendingTranscriptions(next);

    if (next === 0) {
      transcriptionWaitersRef.current.splice(0).forEach((resolve) => resolve());
    }
  };

  const waitForPendingTranscriptions = () => {
    if (pendingTranscriptionsRef.current === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      transcriptionWaitersRef.current.push(resolve);
    });
  };

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      setSettings({
        ...DEFAULT_SETTINGS,
        ...parsed,
        refreshIntervalSeconds: coercePositiveInteger(
          parsed.refreshIntervalSeconds,
          DEFAULT_SETTINGS.refreshIntervalSeconds,
        ),
        suggestionContextEntries: coercePositiveInteger(
          parsed.suggestionContextEntries,
          DEFAULT_SETTINGS.suggestionContextEntries,
        ),
        detailContextEntries: coercePositiveInteger(
          parsed.detailContextEntries,
          DEFAULT_SETTINGS.detailContextEntries,
        ),
        chatContextEntries: coercePositiveInteger(
          parsed.chatContextEntries,
          DEFAULT_SETTINGS.chatContextEntries,
        ),
      });
    } catch {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    setSecondsUntilRefresh(settings.refreshIntervalSeconds);
  }, [settings.refreshIntervalSeconds]);

  useEffect(() => {
    if (!transcriptScrollRef.current) {
      return;
    }

    transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
  }, [transcript]);

  useEffect(() => {
    if (!chatScrollRef.current) {
      return;
    }

    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const currentSettings = settingsRef.current;

    if (!currentSettings.groqApiKey.trim()) {
      return;
    }

    const completedTranscript = transcript.filter(
      (entry) => !entry.pending && !entry.error,
    );
    const latestCompletedEntry = completedTranscript[completedTranscript.length - 1];

    if (!latestCompletedEntry) {
      return;
    }

    const context = buildContext(transcript, currentSettings.suggestionContextEntries);
    if (!context) {
      return;
    }

    const autoSuggestionKey = `${latestCompletedEntry.id}:${context}`;
    if (autoSuggestionKey === lastAutoSuggestionKeyRef.current) {
      return;
    }

    lastAutoSuggestionKeyRef.current = autoSuggestionKey;
    void refreshSuggestions({
      force: true,
      transcriptSnapshot: transcript,
    });
  }, [transcript]);

  const createTranscriptEntry = (text: string, options?: Partial<TranscriptEntry>) => {
    const time = getTimeParts();

    return {
      id: createId("transcript"),
      createdAt: time.createdAt,
      timestamp: time.timestamp,
      text,
      ...options,
    };
  };

  async function refreshSuggestions(options?: {
    force?: boolean;
    transcriptSnapshot?: TranscriptEntry[];
  }) {
    const source = options?.transcriptSnapshot ?? transcriptRef.current;
    const currentSettings = settingsRef.current;
    const context = buildContext(source, currentSettings.suggestionContextEntries);

    if (!currentSettings.groqApiKey.trim()) {
      setSuggestionError("Add your Groq API key in Settings to generate suggestions.");
      return;
    }

    if (!context) {
      setSuggestionError("Say a little more before generating suggestions.");
      return;
    }

    if (isLoadingSuggestions && !options?.force) {
      return;
    }

    setIsLoadingSuggestions(true);
    setSuggestionError(null);

    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-groq-api-key": currentSettings.groqApiKey,
        },
        body: JSON.stringify({
          model: currentSettings.reasoningModel,
          prompt: currentSettings.liveSuggestionPrompt,
          transcript: context,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        suggestions?: SuggestionApiItem[];
      };

      if (!response.ok) {
        throw new Error(data.error || "Suggestion generation failed.");
      }

      if ((data.suggestions ?? []).length !== 3) {
        throw new Error("Suggestions must return exactly 3 items.");
      }

      const time = getTimeParts();

      setSuggestionBatches((current) => {
        const nextBatchNumber = (current[0]?.batchNumber ?? 0) + 1;
        const batchId = createId("batch");
        const nextBatch: SuggestionBatch = {
          id: batchId,
          batchNumber: nextBatchNumber,
          createdAt: time.createdAt,
          timestamp: time.timestamp,
          suggestions: (data.suggestions ?? []).map((suggestion) => ({
            id: createId("suggestion"),
            batchId,
            batchNumber: nextBatchNumber,
            createdAt: time.createdAt,
            timestamp: time.timestamp,
            type: suggestion.type,
            text: suggestion.text,
          })),
        };

        return [nextBatch, ...current];
      });

      setSecondsUntilRefresh(currentSettings.refreshIntervalSeconds);
    } catch (suggestionRequestError) {
      setSuggestionError(
        suggestionRequestError instanceof Error
          ? suggestionRequestError.message
          : "Unexpected suggestion error.",
      );
    } finally {
      setIsLoadingSuggestions(false);
    }
  }

  async function askAssistant(
    question: string,
    label: string,
    mode: "detail" | "chat",
  ) {
    const trimmed = question.trim();
    if (!trimmed) {
      return;
    }

    const currentSettings = settingsRef.current;
    const context = buildContext(
      transcriptRef.current,
      mode === "detail"
        ? currentSettings.detailContextEntries
        : currentSettings.chatContextEntries,
    );

    const userTime = getTimeParts();
    const userMessage: ChatMessageData = {
      id: createId("chat"),
      createdAt: userTime.createdAt,
      timestamp: userTime.timestamp,
      role: "user",
      label,
      content: trimmed,
      mode,
    };

    if (!currentSettings.groqApiKey.trim()) {
      const assistantTime = getTimeParts();
      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: createId("chat"),
          createdAt: assistantTime.createdAt,
          timestamp: assistantTime.timestamp,
          role: "assistant",
          content: "Missing Groq API key. Open Settings and add your key first.",
          error: true,
          mode,
        },
      ]);
      return;
    }

    if (!context) {
      const assistantTime = getTimeParts();
      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: createId("chat"),
          createdAt: assistantTime.createdAt,
          timestamp: assistantTime.timestamp,
          role: "assistant",
          content: "I need more transcript context before I can answer that well.",
          error: true,
          mode,
        },
      ]);
      return;
    }

    const assistantTime = getTimeParts();
    const assistantId = createId("chat");

    setIsChatLoading(true);
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantId,
        createdAt: assistantTime.createdAt,
        timestamp: assistantTime.timestamp,
        role: "assistant",
        content: "Thinking through the meeting context...",
        pending: true,
        mode,
      },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-groq-api-key": currentSettings.groqApiKey,
        },
        body: JSON.stringify({
          model: currentSettings.reasoningModel,
          mode,
          prompt:
            mode === "detail"
              ? currentSettings.detailAnswerPrompt
              : currentSettings.chatPrompt,
          question: trimmed,
          transcript: context,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string;
        };
        throw new Error(data.error || "Detailed answer generation failed.");
      }

      if (!response.body) {
        throw new Error("No streamed answer was returned.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        answer += decoder.decode(value, { stream: true });

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: answer,
                  pending: true,
                  error: false,
                }
              : message,
          ),
        );
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: answer.trim() || "No answer returned.",
                pending: false,
                error: false,
              }
            : message,
        ),
      );
    } catch (chatError) {
      const message =
        chatError instanceof Error ? chatError.message : "Unexpected chat error.";

      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: message,
                pending: false,
                error: true,
              }
            : item,
        ),
      );
    } finally {
      setIsChatLoading(false);
    }
  }

  const { error, flushCurrentChunk, isRecording, status, toggle } = useAudioRecorder({
    chunkMs: settings.refreshIntervalSeconds * 1000,
    onChunk: async (blob) => {
      const currentSettings = settingsRef.current;
      const entry = createTranscriptEntry("Transcribing audio chunk...", {
        pending: true,
      });

      setTranscript((current) => [...current, entry]);
      updatePendingTranscriptions(pendingTranscriptionsRef.current + 1);

      if (!currentSettings.groqApiKey.trim()) {
        setTranscript((current) =>
          current.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  text: "Missing Groq API key. Open Settings and add your key before recording.",
                  pending: false,
                  error: true,
                }
              : item,
          ),
        );
        updatePendingTranscriptions(
          Math.max(0, pendingTranscriptionsRef.current - 1),
        );
        return;
      }

      try {
        const formData = new FormData();
        formData.append(
          "audio",
          new File([blob], "meeting-chunk.webm", {
            type: blob.type || "audio/webm",
          }),
        );
        formData.append("model", currentSettings.transcriptionModel);
        formData.append("language", currentSettings.language);

        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "x-groq-api-key": currentSettings.groqApiKey,
          },
          body: formData,
        });

        const data = (await response.json()) as { error?: string; text?: string };

        if (!response.ok) {
          throw new Error(data.error || "Transcription failed.");
        }

        let nextTranscript: TranscriptEntry[] = [];

        setTranscript((current) => {
          nextTranscript = current.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  text: data.text?.trim() || "No speech detected in this chunk.",
                  pending: false,
                  error: false,
                }
              : item,
          );

          return nextTranscript;
        });

      } catch (chunkError) {
        const message =
          chunkError instanceof Error
            ? chunkError.message
            : "Unexpected transcription error.";

        setTranscript((current) =>
          current.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  text: message,
                  pending: false,
                  error: true,
                }
              : item,
          ),
        );
      } finally {
        updatePendingTranscriptions(
          Math.max(0, pendingTranscriptionsRef.current - 1),
        );
      }
    },
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSecondsUntilRefresh((current) => {
        if (current <= 1) {
          const hasCompletedTranscript = transcriptRef.current.some(
            (entry) => !entry.pending && !entry.error,
          );

          if (
            !isRecording &&
            hasCompletedTranscript &&
            !refreshInFlightRef.current
          ) {
            void handleRefresh("auto");
          }

          return settings.refreshIntervalSeconds;
        }

        return current - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isRecording, settings.refreshIntervalSeconds]);

  async function handleRefresh(source: "auto" | "manual") {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;

    if (source === "manual") {
      setIsManualRefreshing(true);
    }

    try {
      if (isRecording) {
        await flushCurrentChunk();
        await waitForPendingTranscriptions();
        setSecondsUntilRefresh(settingsRef.current.refreshIntervalSeconds);
        return;
      }

      await waitForPendingTranscriptions();
      await refreshSuggestions({ force: true });
      setSecondsUntilRefresh(settingsRef.current.refreshIntervalSeconds);
    } finally {
      if (source === "manual") {
        setIsManualRefreshing(false);
      }

      refreshInFlightRef.current = false;
    }
  }

  function handleExport() {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: {
        ...settings,
        groqApiKey: settings.groqApiKey ? "[redacted]" : "",
      },
      transcript,
      suggestionBatches,
      chatHistory: messages,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `twinmind-session-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleSuggestionSelect(suggestion: Suggestion) {
    void askAssistant(suggestion.text, suggestion.type, "detail");
  }

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    void askAssistant(trimmed, "CUSTOM", "chat");
    setInput("");
  }

  const activeBatch = suggestionBatches[0] ?? null;
  const previousBatches = suggestionBatches.slice(1);

  const statusLabel =
    status === "recording"
      ? "LISTENING"
      : status === "requesting"
        ? "REQUESTING"
        : status === "error"
          ? "ERROR"
          : "IDLE";

  const refreshLabel = useMemo(() => {
    if (isManualRefreshing) {
      return "UPDATING";
    }

    if (isLoadingSuggestions || pendingTranscriptions > 0) {
      return "REFRESHING";
    }

    return `${suggestionBatches.length} BATCH${suggestionBatches.length === 1 ? "" : "ES"}`;
  }, [
    isLoadingSuggestions,
    isManualRefreshing,
    pendingTranscriptions,
    suggestionBatches.length,
  ]);

  return (
    <main className="relative h-screen overflow-hidden bg-transparent text-zinc-100">
      <SettingsModal
        onClose={() => setIsSettingsOpen(false)}
        onSettingsChange={(key, value) =>
          setSettings((current) => ({
            ...current,
            [key]: value,
          }))
        }
        open={isSettingsOpen}
        settings={settings}
      />

      <div className="grid h-full grid-cols-1 divide-y divide-zinc-900 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <ColumnShell>
          <Header title="1. MIC & TRANSCRIPT" status={statusLabel} />
          <div className="border-b border-zinc-900 px-5 py-5">
            <div className="space-y-4">
              <div className="flex items-center gap-4 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                <button
                  type="button"
                  onClick={toggle}
                  className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border text-zinc-100 shadow-[0_0_40px_rgba(56,189,248,0.12)] transition ${
                    isRecording
                      ? "border-rose-400/40 bg-rose-500/10 text-rose-200 hover:border-rose-300"
                      : "border-zinc-700 bg-zinc-900 hover:border-sky-400/40 hover:text-sky-300"
                  }`}
                  aria-label="Toggle microphone"
                >
                  <Mic className="h-7 w-7" />
                </button>
                <div>
                  <p className="text-sm font-medium text-zinc-100">
                    {isRecording
                      ? "Recording live. Click to pause."
                      : status === "requesting"
                        ? "Requesting microphone access..."
                        : "Stopped. Click to resume."}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {error ??
                      "Transcript updates arrive on each chunk, and manual refresh can flush the current chunk early."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/70 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
                >
                  <Settings2 className="h-4 w-4" />
                  Settings
                </button>

                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/70 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
                >
                  <Download className="h-4 w-4" />
                  Export Session
                </button>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-400">
                Refresh cadence: every {settings.refreshIntervalSeconds}s
                {isRecording ? ` - next chunk in ${secondsUntilRefresh}s` : ""}
              </div>
            </div>
          </div>

          <div ref={transcriptScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-4">
              {transcript.length === 0 ? (
                <EmptyState
                  title="No transcript yet"
                  description="Start the mic to append transcript chunks roughly every refresh window. New lines will auto-scroll into view."
                />
              ) : (
                transcript.map((entry) => <TranscriptItem key={entry.id} entry={entry} />)
              )}
            </div>
          </div>
        </ColumnShell>

        <ColumnShell>
          <Header title="2. LIVE SUGGESTIONS" status={refreshLabel} />
          <div className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950/95 px-5 py-4 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => void handleRefresh("manual")}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isManualRefreshing}
              >
                <RefreshCcw
                  className={`h-4 w-4 ${
                    isManualRefreshing || isLoadingSuggestions ? "animate-spin" : ""
                  }`}
                />
                Refresh transcript + suggestions
              </button>
              <span className="text-xs text-zinc-500">
                {isRecording ? `chunk closes in ${secondsUntilRefresh}s` : "mic idle"}
              </span>
            </div>
            {suggestionError ? (
              <p className="mt-3 text-xs text-rose-300">{suggestionError}</p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-6">
              {!activeBatch ? (
                <EmptyState
                  title="No suggestions yet"
                  description="Once transcript context arrives, each refresh will pin a fresh batch of exactly 3 suggestions at the top."
                />
              ) : (
                <>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                        Latest Batch {activeBatch.batchNumber}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                        {activeBatch.timestamp}
                      </span>
                    </div>
                    {activeBatch.suggestions.map((suggestion) => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        onSelect={handleSuggestionSelect}
                      />
                    ))}
                  </div>

                  {previousBatches.length > 0 ? (
                    <div className="space-y-6 pt-2">
                      {previousBatches.map((batch) => (
                        <div key={batch.id} className="space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="h-px flex-1 bg-zinc-800" />
                            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                              Batch {batch.batchNumber}
                            </span>
                            <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-600">
                              {batch.timestamp}
                            </span>
                            <div className="h-px flex-1 bg-zinc-800" />
                          </div>
                          <div className="space-y-4 opacity-60">
                            {batch.suggestions.map((suggestion) => (
                              <SuggestionCard
                                key={suggestion.id}
                                suggestion={suggestion}
                                onSelect={handleSuggestionSelect}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </ColumnShell>

        <ColumnShell>
          <Header title="3. CHAT (DETAILED ANSWERS)" status="SESSION-ONLY" />
          <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-4">
              {messages.length === 0 ? (
                <EmptyState
                  title="No chat yet"
                  description="Click a live suggestion or ask your own question. The right panel keeps one continuous session for the current meeting."
                />
              ) : (
                messages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))
              )}
            </div>
          </div>

          <div className="border-t border-zinc-900 bg-zinc-950/95 px-5 py-4">
            <div className="flex items-center gap-3 rounded-3xl border border-zinc-800 bg-zinc-950/90 p-3">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleSend();
                  }
                }}
                placeholder="Ask anything..."
                className="h-12 flex-1 border-none bg-transparent px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={handleSend}
                className="inline-flex h-12 items-center gap-2 rounded-2xl bg-zinc-100 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isChatLoading}
              >
                <Send className="h-4 w-4" />
                {isChatLoading ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </ColumnShell>
      </div>
    </main>
  );
}
