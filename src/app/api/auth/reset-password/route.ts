import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  token: z.string().min(16, "Некорректная ссылка"),
  password: z.string().min(8, "Пароль не короче 8 символов").max(128),
});

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  const ri = request.headers.get("x-real-ip");
  return ri?.trim() || "unknown";
}

export async function POST(request: Request) {
  const hit = checkRateLimit(`reset:${clientIp(request)}`, 12, 3_600_000);
  if (!hit.ok) {
    return NextResponse.json(
      { error: "Слишком много попыток. Повторите позже." },
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
    const msg = parsed.error.flatten().fieldErrors;
    const text =
      Object.entries(msg)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("; ") || "Некорректные данные";
    return NextResponse.json({ error: text }, { status: 400 });
  }

  const tokenHash = hashToken(parsed.data.token.trim());

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.expiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "Ссылка недействительна или истекла. Запросите новую." },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId } });
  });

  return NextResponse.json({ ok: true });
}
