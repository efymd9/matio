"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  ADMIN_SUPPORTED_LOCALES,
  type AdminLocale,
} from "./admin-dictionaries";
import { ADMIN_LOCALE_COOKIE_NAME } from "./admin-shared";

// Server action invoked by the language switcher in the admin nav.
// Writes a long-lived cookie and revalidates the admin layout so the
// admin tree re-renders with the new dictionary. The cookie is separate
// from the public `locale` cookie on purpose — flipping the admin panel
// to Russian must never change the visitor-facing site language.
export async function setAdminLocale(locale: AdminLocale): Promise<void> {
  if (!(ADMIN_SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return;
  }
  const c = await cookies();
  c.set(ADMIN_LOCALE_COOKIE_NAME, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/admin", "layout");
}
