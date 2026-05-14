"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CEREBRAS_MODEL_IDS,
  CEREBRAS_MODELS,
  DEFAULT_CEREBRAS_MODEL,
} from "@/lib/cerebras-models";
import { ASSISTANT_MAX_MESSAGE_CHARS } from "@/lib/assistant-request";
import {
  DEFAULT_PRESET,
  WORK_PRESETS,
  type WorkPresetId,
} from "@/lib/presets";

type ChatMessage = { id?: string; role: "user" | "assistant"; content: string };

type ConversationListItem = {
  id: string;
  title: string;
  preset: string;
  modelId: string;
  updatedAt?: string;
};

function stripForApi(msgs: ChatMessage[]): Pick<ChatMessage, "role" | "content">[] {
  return msgs.map(({ role, content }) => ({ role, content }));
}

function messagesToMarkdown(msgs: ChatMessage[]): string {
  return msgs
    .filter((m) => m.content.trim())
    .map((m) => `### ${m.role === "user" ? "Пользователь" : "Ассистент"}\n\n${m.content}`)
    .join("\n\n---\n\n");
}

function fmtListDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function parsePresetId(raw: string | undefined): WorkPresetId {
  if (raw && raw in WORK_PRESETS) return raw as WorkPresetId;
  return DEFAULT_PRESET;
}

function parseModelId(raw: string | undefined): string {
  if (raw && CEREBRAS_MODEL_IDS.has(raw)) return raw;
  return DEFAULT_CEREBRAS_MODEL;
}

export function Workspace() {
  const { status } = useSession();
  const [preset, setPreset] = useState<WorkPresetId>(DEFAULT_PRESET);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelId, setModelId] = useState(DEFAULT_CEREBRAS_MODEL);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [chatQuery, setChatQuery] = useState("");
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [oldestMessageId, setOldestMessageId] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [filePasteHint, setFilePasteHint] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [bootstrapping, setBootstrapping] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const presetList = useMemo(
    () =>
      (Object.keys(WORK_PRESETS) as WorkPresetId[]).map((id) => ({
        id,
        ...WORK_PRESETS[id],
      })),
    [],
  );

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const refetchConversations = useCallback(async (query?: string) => {
    const q = typeof query === "string" ? query.trim() : "";
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    const res = await fetch(`/api/conversations${qs}`);
    if (!res.ok) return;
    const data = (await res.json()) as { conversations?: ConversationListItem[] };
    const list = data.conversations ?? [];
    setConversations(list);
    return list;
  }, []);

  const applyConversationPayload = useCallback(
    (data: {
      preset?: string;
      modelId?: string;
      messages?: ChatMessage[];
      hasMoreOlder?: boolean;
      oldestMessageId?: string | null;
    }) => {
      setPreset(parsePresetId(data.preset));
      setModelId(parseModelId(data.modelId));
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setHasMoreOlder(Boolean(data.hasMoreOlder));
      setOldestMessageId(data.oldestMessageId ?? null);
    },
    [],
  );

  const loadConversation = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}?limit=120`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        prepend?: boolean;
        preset?: string;
        modelId?: string;
        messages?: ChatMessage[];
        hasMoreOlder?: boolean;
        oldestMessageId?: string | null;
      };

      if (data.prepend) {
        const block = Array.isArray(data.messages) ? data.messages : [];
        setMessages((prev) => [...block, ...prev]);
        setHasMoreOlder(Boolean(data.hasMoreOlder));
        setOldestMessageId(data.oldestMessageId ?? null);
        return;
      }

      applyConversationPayload(data);
    },
    [applyConversationPayload],
  );

  useEffect(() => {
    if (status === "unauthenticated") {
      setBootstrapping(false);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const t = setTimeout(() => {
      void refetchConversations(chatQuery);
    }, 320);
    return () => clearTimeout(t);
  }, [chatQuery, status, refetchConversations]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let cancelled = false;
    (async () => {
      setBootstrapping(true);
      try {
        let list = await refetchConversations(chatQuery);
        if (cancelled) return;
        if (!list || list.length === 0) {
          const created = await fetch("/api/conversations", {
            method: "POST",
          });
          if (!created.ok || cancelled) return;
          const row = (await created.json()) as ConversationListItem;
          setConversations([row]);
          setActiveConversationId(row.id);
          setPreset(parsePresetId(row.preset));
          setModelId(parseModelId(row.modelId));
          setMessages([]);
          setHasMoreOlder(false);
          setOldestMessageId(null);
          return;
        }
        const first = list[0]!;
        setActiveConversationId(first.id);
        await loadConversation(first.id);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // только при первом входе / сессии — не триггерим при каждом chatQuery (есть отдельный debounce)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, loadConversation, refetchConversations]);

  const patchConversation = useCallback(
    async (id: string, body: { title?: string; preset?: string; modelId?: string }) => {
      await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await refetchConversations(chatQuery);
    },
    [refetchConversations, chatQuery],
  );

  const selectConversation = useCallback(
    async (id: string) => {
      if (id === activeConversationId) return;
      abortRef.current?.abort();
      setActiveConversationId(id);
      setError(null);
      setRenamingId(null);
      await loadConversation(id);
      setNavOpen(false);
    },
    [activeConversationId, loadConversation],
  );

  const createNewChat = useCallback(async () => {
    abortRef.current?.abort();
    setError(null);
    if (status !== "authenticated") {
      setMessages([]);
      setHasMoreOlder(false);
      setOldestMessageId(null);
      setNavOpen(false);
      return;
    }
    const res = await fetch("/api/conversations", { method: "POST" });
    if (!res.ok) return;
    const row = (await res.json()) as ConversationListItem;
    setConversations((prev) => [row, ...prev]);
    setActiveConversationId(row.id);
    setPreset(parsePresetId(row.preset));
    setModelId(parseModelId(row.modelId));
    setMessages([]);
    setHasMoreOlder(false);
    setOldestMessageId(null);
    setRenamingId(null);
    setNavOpen(false);
  }, [status]);

  const deleteActiveChat = useCallback(async () => {
    abortRef.current?.abort();
    if (status !== "authenticated") {
      setMessages([]);
      setError(null);
      setHasMoreOlder(false);
      setOldestMessageId(null);
      return;
    }
    if (!activeConversationId) return;
    setError(null);
    const id = activeConversationId;
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error || `Не удалось удалить чат (${res.status})`);
      return;
    }
    let remainingAfterDelete: ConversationListItem[] = [];
    setConversations((prev) => {
      remainingAfterDelete = prev.filter((c) => c.id !== id);
      return remainingAfterDelete;
    });
    const refreshed = await refetchConversations(chatQuery);
    const list = refreshed ?? remainingAfterDelete;
    setRenamingId(null);
    if (list.length > 0) {
      const next = list[0]!;
      setActiveConversationId(next.id);
      await loadConversation(next.id);
    } else {
      const created = await fetch("/api/conversations", { method: "POST" });
      if (created.ok) {
        const row = (await created.json()) as ConversationListItem;
        setConversations([row]);
        setActiveConversationId(row.id);
        setMessages([]);
        setHasMoreOlder(false);
        setOldestMessageId(null);
        setPreset(parsePresetId(row.preset));
        setModelId(parseModelId(row.modelId));
      } else {
        setActiveConversationId(null);
        setMessages([]);
        setHasMoreOlder(false);
        setOldestMessageId(null);
      }
    }
  }, [
    activeConversationId,
    loadConversation,
    refetchConversations,
    chatQuery,
    status,
  ]);

  useEffect(() => {
    const authedGuest = status === "unauthenticated" && input.trim().length > 0;
    if (!authedGuest) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [input, status]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    const authed = status === "authenticated";
    if (authed && !activeConversationId) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setError(null);
    setInput("");

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setBusy(true);
    requestAnimationFrame(scrollToBottom);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(authed && activeConversationId ? { conversationId: activeConversationId } : {}),
          preset,
          messages: stripForApi(nextMessages),
          model: modelId,
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        const msg = data?.error || `Ошибка ${res.status}`;
        const rid = res.headers.get("x-request-id");
        throw new Error(rid ? `${msg} (id: ${rid})` : msg);
      }

      if (!res.body) {
        throw new Error("Пустой ответ сервера");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { role: "assistant", content: assistantText };
          }
          return copy;
        });
        requestAnimationFrame(scrollToBottom);
      }
      if (authed) {
        await refetchConversations(chatQuery);
        if (activeConversationId) {
          const r = await fetch(
            `/api/conversations/${encodeURIComponent(activeConversationId)}?limit=120`,
          );
          if (r.ok) {
            const d = (await r.json()) as {
              messages?: ChatMessage[];
              hasMoreOlder?: boolean;
              oldestMessageId?: string | null;
            };
            setMessages(Array.isArray(d.messages) ? d.messages : []);
            setHasMoreOlder(Boolean(d.hasMoreOlder));
            setOldestMessageId(d.oldestMessageId ?? null);
          }
        }
      }
    } catch (e) {
      if (
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError")
      ) {
        setMessages((prev) => {
          const last = prev.at(-1);
          if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
          return prev;
        });
        return;
      }
      const message = e instanceof Error ? e.message : "Неизвестная ошибка";
      setError(message);
      setInput(text);
      setMessages((prev) => {
        let next = prev;
        const last = next.at(-1);
        if (last?.role === "assistant") next = next.slice(0, -1);
        const u = next.at(-1);
        if (u?.role === "user" && u.content === text) next = next.slice(0, -1);
        return next;
      });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
      requestAnimationFrame(scrollToBottom);
    }
  }, [
    busy,
    input,
    messages,
    preset,
    modelId,
    scrollToBottom,
    activeConversationId,
    refetchConversations,
    chatQuery,
    status,
  ]);

  const loadOlder = useCallback(async () => {
    if (
      !activeConversationId ||
      !oldestMessageId ||
      loadingOlder ||
      !hasMoreOlder ||
      busy
    ) {
      return;
    }
    setLoadingOlder(true);
    try {
      const url = `/api/conversations/${encodeURIComponent(activeConversationId)}?before=${encodeURIComponent(oldestMessageId)}&limit=80`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages?: ChatMessage[];
        hasMoreOlder?: boolean;
        oldestMessageId?: string | null;
      };
      const block = data.messages ?? [];
      setMessages((prev) => [...block, ...prev]);
      setHasMoreOlder(Boolean(data.hasMoreOlder));
      setOldestMessageId(data.oldestMessageId ?? oldestMessageId);
    } finally {
      setLoadingOlder(false);
    }
  }, [
    activeConversationId,
    hasMoreOlder,
    loadingOlder,
    oldestMessageId,
    busy,
  ]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onPresetChange = useCallback(
    (id: WorkPresetId) => {
      setPreset(id);
      if (activeConversationId) {
        void patchConversation(activeConversationId, { preset: id });
      }
    },
    [activeConversationId, patchConversation],
  );

  const onModelChange = useCallback(
    (id: string) => {
      setModelId(id);
      if (activeConversationId) {
        void patchConversation(activeConversationId, { modelId: id });
      }
    },
    [activeConversationId, patchConversation],
  );

  const copyDialog = useCallback(async () => {
    const md = messagesToMarkdown(messages);
    try {
      await navigator.clipboard.writeText(md || "");
      setFilePasteHint(md ? "Скопировано в буфер" : "Нечего копировать");
      setTimeout(() => setFilePasteHint(null), 2000);
    } catch {
      setFilePasteHint("Не удалось скопировать");
      setTimeout(() => setFilePasteHint(null), 2000);
    }
  }, [messages]);

  const exportMarkdown = useCallback(() => {
    const md = messagesToMarkdown(messages);
    if (!md.trim()) return;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `chat-${activeConversationId ?? "export"}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(u);
  }, [messages, activeConversationId]);

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let t = typeof reader.result === "string" ? reader.result : "";
      if (t.length > ASSISTANT_MAX_MESSAGE_CHARS) {
        t = t.slice(0, ASSISTANT_MAX_MESSAGE_CHARS);
        setFilePasteHint(`Вставлено ${ASSISTANT_MAX_MESSAGE_CHARS.toLocaleString()} символов (лимит)`);
      } else {
        setFilePasteHint(`Файл «${f.name}» добавлен в поле`);
      }
      setInput((prev) => (prev ? `${prev}\n\n${t}` : t));
      setTimeout(() => setFilePasteHint(null), 4000);
    };
    reader.readAsText(f, "UTF-8");
  }, []);

  const saveRename = useCallback(async () => {
    if (!renamingId || !renameDraft.trim()) {
      setRenamingId(null);
      return;
    }
    await patchConversation(renamingId, { title: renameDraft.trim() });
    setRenamingId(null);
  }, [renamingId, renameDraft, patchConversation]);

  if (status === "loading" || (status === "authenticated" && bootstrapping)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
        Загрузка…
      </div>
    );
  }

  const isAuthed = status === "authenticated";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,text/plain"
        className="hidden"
        onChange={onPickFile}
      />

      {navOpen && (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] min-h-0 w-[min(100vw,22rem)] flex-col border-zinc-200 bg-zinc-50 shadow-xl transition-transform duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-950 md:static md:z-0 md:h-auto md:max-h-none md:w-72 md:min-h-0 md:translate-x-0 md:border-b-0 md:border-r md:shadow-none ${
          navOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800 md:hidden">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Настройки
          </span>
          <button
            type="button"
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
            onClick={() => setNavOpen(false)}
            aria-label="Закрыть"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => void createNewChat()}
            disabled={busy}
            className="touch-manipulation w-full rounded-lg bg-zinc-900 py-2.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isAuthed ? "Новый чат" : "Очистить диалог"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Чаты
          </p>
          {isAuthed && (
            <label className="mt-2 block px-2 text-xs">
              <span className="sr-only">Поиск чатов</span>
              <input
                type="search"
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                placeholder="Поиск по названию…"
                className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
          )}
          {!isAuthed ? (
            <p className="mt-2 px-2 text-xs leading-relaxed text-zinc-500">
              Без входа диалог не сохраняется.{" "}
              <Link className="font-medium text-zinc-800 underline dark:text-zinc-200" href="/login">
                Войти
              </Link>{" "}
              — история в облаке.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => void selectConversation(c.id)}
                      disabled={busy || renamingId === c.id}
                      className={`touch-manipulation min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-sm ${
                        c.id === activeConversationId
                          ? "bg-zinc-200 font-medium dark:bg-zinc-800"
                          : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
                      }`}
                    >
                      {renamingId === c.id ? (
                        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            className="w-full rounded border border-zinc-400 bg-white px-1 py-0.5 text-xs dark:bg-zinc-900"
                          />
                          <span className="flex gap-1">
                            <button
                              type="button"
                              className="rounded bg-zinc-900 px-2 py-0.5 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900"
                              onClick={(e) => {
                                e.stopPropagation();
                                void saveRename();
                              }}
                            >
                              Ок
                            </button>
                            <button
                              type="button"
                              className="rounded border px-2 py-0.5 text-[10px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingId(null);
                              }}
                            >
                              Отмена
                            </button>
                          </span>
                        </div>
                      ) : (
                        <>
                          <span className="line-clamp-2">{c.title}</span>
                          {!!c.updatedAt && (
                            <span className="mt-0.5 block text-[10px] text-zinc-500">
                              {fmtListDate(c.updatedAt)}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                    {activeConversationId === c.id && !renamingId && (
                      <button
                        type="button"
                        className="shrink-0 rounded p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        aria-label="Переименовать"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(c.id);
                          setRenameDraft(c.title);
                        }}
                      >
                        ✎
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-zinc-200 p-3 sm:p-4 dark:border-zinc-800">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Режим
          </p>
          <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto overscroll-contain sm:max-h-40">
            {presetList.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPresetChange(p.id)}
                  className={`touch-manipulation w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    preset === p.id
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-700 hover:bg-zinc-200/80 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="font-medium">{p.label}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{p.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Модель
          </p>
          <label className="mt-2 block text-xs text-zinc-600 dark:text-zinc-400">
            <span className="sr-only">Модель Cerebras</span>
            <select
              value={modelId}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={busy}
              className="touch-manipulation mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2.5 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {CEREBRAS_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {status === "unauthenticated" && input.trim().length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
            Без аккаунта текст не сохраняется при закрытии вкладки.{" "}
            <Link className="font-medium underline" href="/login">
              Войти
            </Link>
          </div>
        )}

        <header className="flex shrink-0 flex-wrap items-start gap-2 border-b border-zinc-200 px-3 py-3 sm:px-4 dark:border-zinc-800">
          <button
            type="button"
            className="touch-manipulation mt-0.5 shrink-0 rounded-lg border border-zinc-300 p-2 text-zinc-700 md:hidden dark:border-zinc-600 dark:text-zinc-300"
            onClick={() => setNavOpen(true)}
            aria-label="Открыть настройки"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Рабочий ассистент
            </h1>
            <p className="text-xs leading-snug text-zinc-500 sm:text-xs">
              {busy ? "Получаем ответ…" : WORK_PRESETS[preset].hint}
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-1.5 sm:ml-auto sm:w-auto sm:max-w-[50%] sm:justify-end sm:gap-2">
            {messages.some((m) => m.content.trim()) && (
              <>
                <button
                  type="button"
                  onClick={() => void copyDialog()}
                  className="touch-manipulation rounded-lg border border-zinc-300 px-2 py-1.5 text-[11px] font-medium text-zinc-700 sm:text-xs dark:border-zinc-600 dark:text-zinc-300"
                >
                  Копировать
                </button>
                <button
                  type="button"
                  onClick={exportMarkdown}
                  className="touch-manipulation rounded-lg border border-zinc-300 px-2 py-1.5 text-[11px] font-medium text-zinc-700 sm:text-xs dark:border-zinc-600 dark:text-zinc-300"
                >
                  .md файл
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="touch-manipulation rounded-lg border border-zinc-300 px-2 py-1.5 text-[11px] font-medium text-zinc-700 disabled:opacity-40 sm:text-xs dark:border-zinc-600 dark:text-zinc-300"
                >
                  Файл → поле
                </button>
              </>
            )}
            {busy && (
              <button
                type="button"
                onClick={stop}
                className="touch-manipulation rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 sm:px-3 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40"
              >
                Стоп
              </button>
            )}
            {isAuthed && (
              <button
                type="button"
                onClick={() => void deleteActiveChat()}
                disabled={!activeConversationId}
                className="touch-manipulation rounded-lg border border-zinc-300 px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 sm:text-xs dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <span className="sm:hidden">Удал.</span>
                <span className="hidden sm:inline">Удалить чат</span>
              </button>
            )}
            {isAuthed ? (
              <button
                type="button"
                onClick={() => void signOut({ callbackUrl: "/" })}
                className="touch-manipulation rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 sm:px-3 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Выйти
              </button>
            ) : (
              <>
                <Link
                  href="/login"
                  className="touch-manipulation rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 sm:px-3 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Войти
                </Link>
                <Link
                  href="/register"
                  className="touch-manipulation truncate rounded-lg bg-zinc-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 sm:px-3 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Регистрация
                </Link>
              </>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-4 sm:py-4">
          {hasMoreOlder && activeConversationId && (
            <div className="mx-auto mb-3 max-w-3xl text-center">
              <button
                type="button"
                disabled={loadingOlder || busy}
                onClick={() => void loadOlder()}
                className="touch-manipulation rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
              >
                {loadingOlder ? "Загрузка…" : "Ранние сообщения"}
              </button>
            </div>
          )}
          {messages.length === 0 && (
            <p className="mx-auto max-w-xl text-center text-sm text-zinc-500">
              Выберите режим в меню{" "}
              <span className="md:hidden">(иконка «☰»)</span>
              <span className="hidden md:inline">слева</span>, опишите задачу. Ключ Cerebras (
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">csk-</code>
              ) задайте в{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local</code>.
            </p>
          )}
          <ul className="mx-auto flex max-w-3xl flex-col gap-3 sm:gap-4">
            {messages.map((m, i) => (
              <li
                key={m.id ?? `${m.role}-${i}-${m.content.slice(0, 12)}`}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[min(100%,36rem)] rounded-2xl px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap sm:px-4 ${
                    m.role === "user"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {m.content ||
                    (busy && i === messages.length - 1 && m.role === "assistant" ? "…" : "")}
                </div>
              </li>
            ))}
          </ul>
          <div ref={bottomRef} />
        </div>

        {filePasteHint && (
          <div className="shrink-0 border-t border-zinc-200 bg-zinc-100 px-3 py-1.5 text-center text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {filePasteHint}
          </div>
        )}

        {error && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 sm:px-4">
            {error}
          </div>
        )}

        <footer className="shrink-0 border-t border-zinc-200 bg-zinc-50/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-800 dark:bg-zinc-950/80 sm:p-4">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={3}
              placeholder="Ваш запрос или вставьте текст встречи…"
              className="min-h-[4.5rem] w-full flex-1 resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none ring-zinc-400 focus:ring-2 sm:min-h-[5rem] sm:text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              disabled={busy || (isAuthed && !activeConversationId)}
            />
            <div className="flex shrink-0 justify-end gap-2 self-stretch sm:self-end">
              {busy && (
                <button
                  type="button"
                  onClick={stop}
                  className="touch-manipulation rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
                >
                  Стоп
                </button>
              )}
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || !input.trim() || (isAuthed && !activeConversationId)}
                className="touch-manipulation rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {busy ? "…" : "Отправить"}
              </button>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
