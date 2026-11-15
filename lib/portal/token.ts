import { SignJWT, jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

const ALG = "HS256";
const ISSUER = "accountech-portal";
const AUDIENCE = "client-portal";

export type ClientPortalClaims = {
  client_id: string;
  business_id: string;
  jti: string; // matches client_portal_tokens.id
};

export async function signPortalToken(
  claims: ClientPortalClaims,
  ttlSeconds: number = 60 * 60 * 24 * 30, // 30 days
): Promise<string> {
  const key = new TextEncoder().encode(env().BETTER_AUTH_SECRET);
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
}

export async function verifyPortalToken(
  token: string,
): Promise<ClientPortalClaims | null> {
  try {
    const key = new TextEncoder().encode(env().BETTER_AUTH_SECRET);
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload["client_id"] !== "string" ||
      typeof payload["business_id"] !== "string" ||
      typeof payload["jti"] !== "string"
    ) {
      return null;
    }
    return {
      client_id: payload["client_id"],
      business_id: payload["business_id"],
      jti: payload["jti"],
    };
  } catch {
    return null;
  }
}

/** Hash the raw JWT so we can compare against the DB row without
 *  storing the secret JWT directly. SHA-256 hex. */
export function hashPortalToken(jwt: string): string {
  return createHash("sha256").update(jwt).digest("hex");
}
