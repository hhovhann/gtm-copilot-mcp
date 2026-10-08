import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_SECRET_LENGTH = 16;

export function assertSecret(secret: string | undefined): string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`WEBHOOK_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long.`);
  }
  return secret;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time: both sides are hashed to equal length before comparing. */
export function secretMatches(provided: string | undefined, secret: string): boolean {
  if (provided === undefined) return false;
  return timingSafeEqual(sha256(provided), sha256(secret));
}
