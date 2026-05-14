import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/assistant";

  if (isPublic) {
    return NextResponse.next();
  }

  if (!secret) {
    console.error("AUTH_SECRET (или NEXTAUTH_SECRET) не задан в окружении");
    return NextResponse.json(
      { error: "Конфигурация сервера неполна (AUTH_SECRET)" },
      { status: 500 },
    );
  }

  const token = await getToken({ req: request, secret });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
