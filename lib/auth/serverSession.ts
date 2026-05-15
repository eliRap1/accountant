// Single import surface for everything-server-side that needs the active
// session. App code MUST import from here, not from "@/lib/auth/better" or
// "@/lib/auth/currentUser" directly. If we ever swap Better Auth for
// another provider, only this file changes.

export { currentUser, requireCurrentUser } from "@/lib/auth/currentUser";
export type { CurrentUser } from "@/lib/auth/currentUser";
