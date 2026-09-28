import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getWorkDriveConnectionStatus } from "@/lib/workdrive";

export async function GET() {
  try {
    await requireStaff();
    return NextResponse.json(await getWorkDriveConnectionStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
