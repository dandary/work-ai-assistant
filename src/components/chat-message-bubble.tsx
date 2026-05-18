"use client";

type ChatMessageBubbleProps = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

/** Простой рендер: код в ``` блоках, остальное — pre-wrap. */
function renderContent(text: string, role: "user" | "assistant") {
  if (role === "user" || !text.includes("```")) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }

  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const inner = part.slice(3, -3).replace(/^\w*\n?/, "");
          return (
            <pre
              key={i}
              className="my-2 overflow-x-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800"
            >
              <code>{inner}</code>
            </pre>
          );
        }
        return (
          <span key={i} className="whitespace-pre-wrap">
            {part}
          </span>
        );
      })}
    </>
  );
}

export function ChatMessageBubble({ role, content, streaming }: ChatMessageBubbleProps) {
  const display =
    content || (streaming ? "…" : "");

  return (
    <div
      className={`max-w-[min(100%,36rem)] rounded-2xl px-3 py-3 text-sm leading-relaxed sm:px-4 ${
        role === "user"
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      }`}
    >
      {renderContent(display, role)}
    </div>
  );
}
