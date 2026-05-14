import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  const list = await prisma.conversation.findMany({
    where: {
      userId: session.user.id,
      deletedAt: null,
      ...(q.length > 0 ? { title: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      preset: true,
      modelId: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ conversations: list });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const conv = await prisma.conversation.create({
    data: {
      userId: session.user.id,
      title: "Новый чат",
    },
    select: { id: true, title: true, preset: true, modelId: true, updatedAt: true },
  });

  return NextResponse.json(conv);
}
