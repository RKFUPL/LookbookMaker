import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";

export async function GET() {
  const user = await getStaffSession();
  return NextResponse.json({ user });
}
