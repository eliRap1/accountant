import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware navigation primitives. Use these instead of `next/link`
// and `next/navigation` everywhere inside the `[locale]` tree — they
// auto-prefix the current locale onto every URL.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
