import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "database error";
    return NextResponse.json({ ok: false, db: "down", error: message }, { status: 503 });
  }
}
