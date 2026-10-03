import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { clerkPrimaryEmail, mirrorClerkUser } from "@/lib/user-mirror";

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

  // Local row missing — pull from Clerk and write it the way the webhook
  // does (lib/user-mirror.ts): ON CONFLICT (id) DO NOTHING lets a concurrent
  // webhook landing first win the race without us erroring, and an address
  // held by another row is resolved there (#380). Unresolvable → null (the
  // conflict is already reported by id); Clerk unreachable → throw, nothing
  // was touched and the next request tries again.
  const clerk = await currentUser();
  const email = clerkPrimaryEmail(clerk);
  if (!clerk || !email) return null; // Shouldn't happen — Clerk requires email on signup

  const mirrored = await mirrorClerkUser(userId, email, new Date(clerk.createdAt));
  if (mirrored.status === "clerk_unavailable") {
    throw new Error("users mirror: Clerk unavailable — the address conflict is left for a retry");
  }
  if (mirrored.status === "unresolved") return null;

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
