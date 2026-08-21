import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { apiError, ApiError, readJson } from "@/lib/http";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { User } from "@/models/User";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const now = Date.now();
    const entry = attempts.get(ip);
    if (entry && entry.resetAt > now && entry.count >= 10) {
      throw new ApiError(429, "Too many sign-in attempts. Please wait a few minutes.", "RATE_LIMITED");
    }
    if (!entry || entry.resetAt <= now) attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    else entry.count += 1;

    const input = schema.parse(await readJson(request));
    await connectDb();
    const user = await User.findOne({ email: input.email.toLowerCase(), active: true }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new ApiError(401, "Email or password is incorrect.", "INVALID_CREDENTIALS");
    }
    if (!["admin", "staff"].includes(user.role)) throw new ApiError(403, "Staff access is required.");

    const token = await createSessionToken({
      userId: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
    });
    user.lastLoginAt = new Date();
    await user.save();
    attempts.delete(ip);

    const response = NextResponse.json({ user: { name: user.name, email: user.email, role: user.role } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: getConfig().SESSION_TTL_HOURS * 60 * 60,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
