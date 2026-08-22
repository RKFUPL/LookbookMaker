import { NextResponse } from "next/server";
import { checkStorageHealth } from "@/lib/storage";

export async function GET() {
  try {
    const health = await checkStorageHealth();
    return NextResponse.json(
      {
        ok: true,
        storage: "persistent disk storage: connected",
        provider: health.provider,
        root: health.root,
        publicAssetBase: health.publicBaseUrl || null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Storage health check failed:", error);
    return NextResponse.json(
      { ok: false, storage: "unavailable", error: error instanceof Error ? error.message : "Storage is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
