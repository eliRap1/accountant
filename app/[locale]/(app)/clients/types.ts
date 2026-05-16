// Types + constants for the clients module. Lives in a sibling file
// because actions.ts has `"use server"` which forbids non-async exports
// (Turbopack: "The module has no exports at all" when a non-async export
// is present in a server-actions file).

export const CLIENT_PII_CLEAR_SENTINEL = "__clear__";

export type ClientActionResult =
  | { ok: true; id: string }
  | { error: string };
