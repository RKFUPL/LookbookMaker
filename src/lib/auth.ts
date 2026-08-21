import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Types } from "mongoose";
import { getConfig } from "@/lib/config";
import { ApiError } from "@/lib/http";

export const SESSION_COOKIE = "rk_catalog_session";

export type StaffSession = {
  userId: string;
  email: string;
  name: string;
  role: "admin" | "staff";
};

function key() {
  return new TextEncoder().encode(getConfig().AUTH_SECRET);
}

export async function createSessionToken(session: StaffSession) {
  return new SignJWT({ email: session.email, name: session.name, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${getConfig().SESSION_TTL_HOURS}h`)
    .sign(key());
}

export async function verifySessionToken(token: string): Promise<StaffSession | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!payload.sub || !payload.email || !payload.name || !["admin", "staff"].includes(String(payload.role))) {
      return null;
    }
    return {
      userId: payload.sub,
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as "admin" | "staff",
    };
  } catch {
    return null;
  }
}

export async function getStaffSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function requireStaff() {
  const session = await getStaffSession();
  if (!session) throw new ApiError(401, "Please sign in to continue.", "UNAUTHENTICATED");
  if (!['admin', 'staff'].includes(session.role)) throw new ApiError(403, "Staff access is required.", "FORBIDDEN");
  return session;
}

export async function requireAdminPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  return session;
}

export function asObjectId(value: string) {
  return value as unknown as Types.ObjectId;
}
