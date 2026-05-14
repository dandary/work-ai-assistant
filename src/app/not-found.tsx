import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Страница не найдена
      </h1>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        Проверьте адрес или вернитесь на главную.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        На главную
      </Link>
    </div>
  );
}
