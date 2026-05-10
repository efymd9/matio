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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shows</h1>
        <Link href="/admin/shows/new" className={buttonVariants()}>
          New show
        </Link>
      </div>

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
                className="py-8 text-center text-muted-foreground"
              >
                No shows yet.
              </TableCell>
            </TableRow>
          ) : (
            all.map((show) => (
              <TableRow key={show.id}>
                <TableCell className="font-medium">{show.title}</TableCell>
                <TableCell className="text-muted-foreground">
                  {show.slug}
                </TableCell>
                <TableCell>{show.status}</TableCell>
                <TableCell className="text-muted-foreground">
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
  );
}
