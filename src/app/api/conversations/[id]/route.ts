import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const MESSAGE_PAGE_CAP = 200;

export async function GET(request: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const limitParsed = Number.parseInt(url.searchParams.get("limit") ?? "120", 10);
  const limit = Number.isFinite(limitParsed)
    ? Math.min(Math.max(limitParsed, 1), MESSAGE_PAGE_CAP)
    : 120;
  const before = url.searchParams.get("before")?.trim();

  const conv = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      preset: true,
      modelId: true,
      summary: true,
    },
  });

  if (!conv) {
    return NextResponse.json({ error: "Чат не найден" }, { status: 404 });
  }

  /** Подгрузка более старых сообщений по курсору `before`. */
  if (before) {
    const anchor = await prisma.message.findFirst({
      where: { id: before, conversationId: id },
    });
    if (!anchor) {
      return NextResponse.json({ error: "Некорректный курсор" }, { status: 400 });
    }

    const batch = await prisma.message.findMany({
      where: {
        conversationId: id,
        createdAt: { lt: anchor.createdAt },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMoreOlder = batch.length > limit;
    const slice = hasMoreOlder ? batch.slice(0, limit) : batch;
    const chronological = [...slice].reverse();

    return NextResponse.json({
      prepend: true as const,
      messages: chronological.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      hasMoreOlder,
      oldestMessageId: chronological.length > 0 ? chronological[0]!.id : null,
    });
  }

  const batch = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMoreOlder = batch.length > limit;
  const slice = hasMoreOlder ? batch.slice(0, limit) : batch;
  const chronological = [...slice].reverse();

  return NextResponse.json({
    prepend: false as const,
    id: conv.id,
    title: conv.title,
    preset: conv.preset,
    modelId: conv.modelId,
    summary: conv.summary,
    messages: chronological.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    hasMoreOlder,
    oldestMessageId: chronological.length > 0 ? chronological[0]!.id : null,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const { id } = await params;
  const conv = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id, deletedAt: null },
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
    summary?: unknown;
  };

  const data: { title?: string; preset?: string; modelId?: string; summary?: string | null } = {};
  if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 120);
  if (typeof b.preset === "string" && b.preset.trim()) data.preset = b.preset.trim();
  if (typeof b.modelId === "string" && b.modelId.trim()) data.modelId = b.modelId.trim();
  if (b.summary === null) data.summary = null;
  else if (typeof b.summary === "string") data.summary = b.summary.trim().slice(0, 2000);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data,
    select: { id: true, title: true, preset: true, modelId: true, summary: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const { id } = await params;
  const res = await prisma.conversation.updateMany({
    where: { id, userId: session.user.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (res.count === 0) {
    return NextResponse.json({ error: "Чат не найден" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
