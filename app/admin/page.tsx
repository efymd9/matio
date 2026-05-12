import Link from "next/link";
import { desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { shows } from "@/db/schema";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { softDeleteShow } from "./actions";

export default async function AdminShowsPage() {
  const all = await db
    .select()
    .from(shows)
    .where(isNull(shows.deletedAt))
    .orderBy(desc(shows.updatedAt));

  const published = all.filter((s) => s.status === "published").length;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
            Catalog
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
            Shows
          </h1>
          <p className="mt-1 text-sm text-white/55">
            {all.length} total · {published} published
          </p>
        </div>
        <Link href="/admin/shows/new" className={buttonVariants()}>
          New show
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {all.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-12 text-center text-white/55"
                >
                  No shows yet.
                </TableCell>
              </TableRow>
            ) : (
              all.map((show) => (
                <TableRow key={show.id}>
                  <TableCell className="font-semibold text-white">
                    {show.title}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white/55">
                    {show.slug}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${
                        show.status === "published"
                          ? "bg-[#7fd87a]/15 text-[#7fd87a]"
                          : "bg-white/10 text-white/70"
                      }`}
                    >
                      {show.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-white/55">
                    {show.updatedAt.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/admin/shows/${show.id}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Edit
                      </Link>
                      <form action={softDeleteShow.bind(null, show.id)}>
                        <Button variant="destructive" size="sm" type="submit">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
