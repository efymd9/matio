import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
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

// Like getCurrentUser but lazily syncs the row from Clerk if it's missing.
// Why: the Clerk user.created webhook is asynchronous — a brand-new signup
// can hit /subscribe (or /account, or startCheckout) before the webhook has
// landed, which used to throw "Local user row missing" and crash. Use this
// helper anywhere a missing local mirror would block the user from making
// progress.
export async function getOrSyncCurrentUser(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (existing) return existing;

  // Local row missing — pull from Clerk and upsert. onConflictDoNothing lets
  // a concurrent webhook landing first win the race without us erroring.
  const clerk = await currentUser();
  const email =
    clerk?.primaryEmailAddress?.emailAddress ??
    clerk?.emailAddresses[0]?.emailAddress;
  if (!email) return null; // Shouldn't happen — Clerk requires email on signup

  await db
    .insert(users)
    .values({ id: userId, email })
    .onConflictDoNothing({ target: users.id });

  const [synced] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return synced ?? null;
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
