"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    if (token.length < 16) {
      setError("Некорректная или устаревшая ссылка");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `Ошибка ${res.status}`);
        return;
      }
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
      <h1 className="text-center text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Новый пароль
      </h1>
      <p className="mt-2 text-center text-sm text-zinc-500">
        Минимум 8 символов.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm text-zinc-700 dark:text-zinc-300">
          Пароль
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="block text-sm text-zinc-700 dark:text-zinc-300">
          Повтор пароля
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy || token.length < 16}
          className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy ? "Сохранение…" : "Сохранить пароль"}
        </button>
      </form>
      <Link
        href="/forgot-password"
        className="mt-4 flex w-full justify-center text-sm font-medium text-zinc-700 underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
      >
        Запросить новую ссылку
      </Link>
      <Link
        href="/login"
        className="mt-3 flex w-full justify-center rounded-lg border border-zinc-300 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Ко входу
      </Link>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
      <Suspense
        fallback={
          <div className="w-full max-w-sm animate-pulse rounded-2xl border border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
            Загрузка…
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
