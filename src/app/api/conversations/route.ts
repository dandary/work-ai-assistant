import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const list = await prisma.conversation.findMany({
    where: { userId: session.user.id },
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
    select: { id: true, title: true, preset: true, modelId: true },
  });

  return NextResponse.json(conv);
}
