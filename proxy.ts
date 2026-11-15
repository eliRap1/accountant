import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
// next-intl's `createMiddleware` factory still produces a function with
// the right signature for either file — only the file name changed.
const handleI18nRouting = createMiddleware(routing);

// Russian (`ru-RU`) is marketing-only per Plan v4 Risk #24. Auth/app
// routes lack a CPA-reviewed Russian disclaimer surface, so we silently
// rewrite to the en-US equivalent. We do *not* redirect — keeping the
// URL on /ru-RU/... means the user's locale choice still wins for the
// chrome (LanguageSwitcher), but the page body renders English copy.
const RU_REWRITE_PATTERN =
  /^\/ru-RU\/(sign-in|sign-up|verify-email|forgot-password|reset-password|2fa|passkeys|recovery-codes|post-auth|dashboard|invoices|receipts|transactions|clients|tax|filings|audit|processor-sync|bank-imports|ledger|settings|businesses|billing|ai|onboarding)(\/.*)?$/;

export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (RU_REWRITE_PATTERN.test(pathname)) {
    const rewritten = pathname.replace(/^\/ru-RU\//, "/en-US/");
    const url = request.nextUrl.clone();
    url.pathname = rewritten;
    return NextResponse.rewrite(url);
  }

  return handleI18nRouting(request);
}

export const config = {
  // Match everything except API routes, Next internals, and static assets.
  // The dot-exclusion catches /favicon.ico, /robots.txt, /*.png, etc.
  //
  // CRITICAL: `api` MUST stay in the negative-lookahead so Stripe webhook
  // deliveries at /api/billing/webhook reach the route handler with the
  // raw request body untouched. next-intl's createMiddleware would
  // otherwise rewrite the URL, corrupt the byte-stream Stripe signs
  // against, and break signature verification.
  // `post-auth` excluded: the file at `app/post-auth/page.tsx` is
  // intentionally locale-neutral (it reads the NEXT_LOCALE cookie and
  // dispatches). next-intl's prefix-rewriter would otherwise turn
  // `/post-auth` into `/he-IL/post-auth`, which has no matching file
  // and 404s every verification-email click.
  matcher: ["/((?!api|_next/static|_next/image|_vercel|post-auth|.*\\..*).*)"],
};
