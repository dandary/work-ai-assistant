"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Что-то пошло не так
      </h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {error.message || "Не удалось выполнить запрос. Попробуйте ещё раз."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Повторить
      </button>
    </div>
  );
}
