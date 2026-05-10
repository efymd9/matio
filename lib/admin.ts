import "server-only";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

export async function getCurrentUser(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

export async function getCurrentAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

// For pages and server actions: throws redirect if the caller isn't an admin.
// proxy.ts is the first line of defense; this is belt-and-braces for server
// actions that bypass route matching.
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentAdmin();
  if (!user) redirect("/");
  return user;
}
