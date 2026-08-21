import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { apiError, ApiError } from "@/lib/http";
import { isLocalStorage, writeLocalObject } from "@/lib/storage";

export async function PUT(request: Request) {
  try {
    await requireStaff();
    if (!isLocalStorage()) throw new ApiError(410, "This deployment uses direct signed object-storage uploads.", "DIRECT_STORAGE_UPLOAD");
    const key = new URL(request.url).searchParams.get("key") || "";
    if (!key.startsWith("catalogs/") || !request.body) throw new ApiError(400, "Invalid local upload.", "INVALID_UPLOAD");
    await writeLocalObject(key, request.body);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
