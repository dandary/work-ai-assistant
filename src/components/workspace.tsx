"use client";

import { useSession, signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CEREBRAS_MODEL_IDS,
  CEREBRAS_MODELS,
  DEFAULT_CEREBRAS_MODEL,
} from "@/lib/cerebras-models";
import {
  DEFAULT_PRESET,
  WORK_PRESETS,
  type WorkPresetId,
} from "@/lib/presets";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ConversationListItem = {
  id: string;
  title: string;
  preset: string;
  modelId: string;
};

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
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    [],
  );
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const refetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
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
    }) => {
      setPreset(parsePresetId(data.preset));
      setModelId(parseModelId(data.modelId));
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    },
    [],
  );

  const loadConversation = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        preset?: string;
        modelId?: string;
        messages?: ChatMessage[];
      };
      applyConversationPayload(data);
    },
    [applyConversationPayload],
  );

  useEffect(() => {
    if (status !== "authenticated") {
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setBootstrapping(true);
      try {
        let list = await refetchConversations();
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
  }, [status, refetchConversations, loadConversation]);

  const patchConversation = useCallback(
    async (id: string, body: { title?: string; preset?: string; modelId?: string }) => {
      await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      void refetchConversations();
    },
    [refetchConversations],
  );

  const selectConversation = useCallback(
    async (id: string) => {
      if (id === activeConversationId) return;
      abortRef.current?.abort();
      setActiveConversationId(id);
      setError(null);
      await loadConversation(id);
    },
    [activeConversationId, loadConversation],
  );

  const createNewChat = useCallback(async () => {
    abortRef.current?.abort();
    setError(null);
    const res = await fetch("/api/conversations", { method: "POST" });
    if (!res.ok) return;
    const row = (await res.json()) as ConversationListItem;
    setConversations((prev) => [row, ...prev]);
    setActiveConversationId(row.id);
    setPreset(parsePresetId(row.preset));
    setModelId(parseModelId(row.modelId));
    setMessages([]);
  }, []);

  const deleteActiveChat = useCallback(async () => {
    if (!activeConversationId) return;
    abortRef.current?.abort();
    const id = activeConversationId;
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    const list = await refetchConversations();
    if (list && list.length > 0) {
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
        setPreset(parsePresetId(row.preset));
        setModelId(parseModelId(row.modelId));
      } else {
        setActiveConversationId(null);
        setMessages([]);
      }
    }
  }, [
    activeConversationId,
    loadConversation,
    refetchConversations,
  ]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !activeConversationId) return;

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
          conversationId: activeConversationId,
          preset,
          messages: nextMessages,
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
      void refetchConversations();
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

  if (status === "loading" || bootstrapping) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
        Загрузка…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="flex max-h-[40vh] shrink-0 flex-col border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 md:max-h-none md:w-72 md:border-b-0 md:border-r">
        <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => void createNewChat()}
            disabled={busy}
            className="w-full rounded-lg bg-zinc-900 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Новый чат
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Чаты
          </p>
          <ul className="mt-2 space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void selectConversation(c.id)}
                  disabled={busy}
                  className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                    c.id === activeConversationId
                      ? "bg-zinc-200 font-medium dark:bg-zinc-800"
                      : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
                  }`}
                >
                  <span className="line-clamp-2">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Режим
          </p>
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto">
            {presetList.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPresetChange(p.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
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
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
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

      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Рабочий ассистент
            </h1>
            <p className="text-xs text-zinc-500">
              {busy ? "Получаем ответ…" : WORK_PRESETS[preset].hint}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {busy && (
              <button
                type="button"
                onClick={stop}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40"
              >
                Стоп
              </button>
            )}
            <button
              type="button"
              onClick={() => void deleteActiveChat()}
              disabled={busy || !activeConversationId}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Удалить чат
            </button>
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Выйти
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <p className="mx-auto max-w-xl text-center text-sm text-zinc-500">
              Выберите режим слева, опишите задачу. Ключ Cerebras (
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">csk-</code>
              ) задайте в{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local</code>.
            </p>
          )}
          <ul className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((m, i) => (
              <li
                key={`${m.role}-${i}-${m.content.slice(0, 12)}`}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {m.content ||
                    (busy && i === messages.length - 1 && m.role === "assistant"
                      ? "…"
                      : "")}
                </div>
              </li>
            ))}
          </ul>
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        <footer className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mx-auto flex max-w-3xl flex-wrap items-end gap-2">
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
              className="min-h-[5rem] flex-1 resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              disabled={busy || !activeConversationId}
            />
            <div className="flex shrink-0 gap-2 self-end">
              {busy && (
                <button
                  type="button"
                  onClick={stop}
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
                >
                  Стоп
                </button>
              )}
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || !input.trim() || !activeConversationId}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
