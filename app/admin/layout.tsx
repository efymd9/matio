import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <div className="flex flex-1 flex-col">
      <nav className="border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link href="/admin" className="font-semibold">
            Admin
          </Link>
          <Link
            href="/admin"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Shows
          </Link>
          <Link
            href="/"
            className="ml-auto text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to app
          </Link>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
