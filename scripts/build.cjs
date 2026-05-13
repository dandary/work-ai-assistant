const { execSync } = require("child_process");

const db = process.env.DATABASE_URL ?? "";
const isPg =
  db.startsWith("postgresql://") || db.startsWith("postgres://");

if (isPg) {
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
} else {
  console.warn(
    "[build] DATABASE_URL не PostgreSQL — prisma migrate deploy пропущен. Для Vercel задайте DATABASE_URL (Neon и т.д.).",
  );
}

execSync("npx next build", { stdio: "inherit" });
