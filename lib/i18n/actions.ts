"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  SUPPORTED_LOCALES,
  type Locale,
} from "./dictionaries";
import { LOCALE_COOKIE } from "./server";

// Server action invoked by the language switcher in the site header.
// Writes a long-lived cookie and revalidates the root layout so the whole
// tree re-renders with the new dictionary (including <html lang>).
export async function setLocale(locale: Locale): Promise<void> {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return;
  }
  const c = await cookies();
  c.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}
