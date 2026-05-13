import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const registerSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z
    .string()
    .min(8, "Пароль не короче 8 символов")
    .max(128, "Пароль слишком длинный"),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    const text =
      Object.entries(msg)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("; ") || "Некорректные данные";
    return NextResponse.json({ error: text }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json(
      { error: "Пользователь с таким email уже зарегистрирован" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.create({
    data: { email, passwordHash },
  });

  return NextResponse.json({ ok: true });
}
