import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const { id } = await params;

  const conv = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conv) {
    return NextResponse.json({ error: "Чат не найден" }, { status: 404 });
  }

  return NextResponse.json({
    id: conv.id,
    title: conv.title,
    preset: conv.preset,
    modelId: conv.modelId,
    messages: conv.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const { id } = await params;
  const conv = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!conv) {
    return NextResponse.json({ error: "Чат не найден" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const b = body as {
    title?: unknown;
    preset?: unknown;
    modelId?: unknown;
  };

  const data: { title?: string; preset?: string; modelId?: string } = {};
  if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 120);
  if (typeof b.preset === "string" && b.preset.trim()) data.preset = b.preset.trim();
  if (typeof b.modelId === "string" && b.modelId.trim()) data.modelId = b.modelId.trim();

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data,
    select: { id: true, title: true, preset: true, modelId: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const { id } = await params;
  const res = await prisma.conversation.deleteMany({
    where: { id, userId: session.user.id },
  });

  if (res.count === 0) {
    return NextResponse.json({ error: "Чат не найден" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
