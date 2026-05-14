import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  email: z.string().email("Некорректный email"),
});

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function originFromRequest(request: Request): string {
  const env =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
    process.env.AUTH_URL?.replace(/\/$/, "") ||
    "";
  if (env) return env;
  const h = request.headers.get("origin") || request.headers.get("host");
  if (h?.startsWith("http")) return h;
  if (h) return `https://${h}`;
  return "http://localhost:3000";
}

function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  const ri = request.headers.get("x-real-ip");
  return ri?.trim() || "unknown";
}

export async function POST(request: Request) {
  const hit = checkRateLimit(`forgot:${clientIp(request)}`, 8, 3_600_000);
  if (!hit.ok) {
    return NextResponse.json(
      { error: "Слишком много запросов. Повторите позже." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  /** Один ответ клиенту (без перечисления существования email). */
  const generic = {
    ok: true as const,
    message:
      "Если такой аккаунт зарегистрирован, на почту отправлены инструкции по сбросу пароля.",
  };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(generic);
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.create({
    data: { tokenHash, userId: user.id, expiresAt },
  });

  const origin = originFromRequest(request);
  const resetLink = `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`;

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const from = process.env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Сброс пароля — рабочий ассистент",
        html: `<p>Ссылка действует 1 час.</p><p><a href="${resetLink}">Сбросить пароль</a></p>`,
      }),
    });
  } else if (process.env.NODE_ENV === "development") {
    console.info("[forgot-password] reset link:", resetLink);
  }

  return NextResponse.json(generic);
}
