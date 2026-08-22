import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    storage: "external PDF mode",
    provider: "external_pdf",
    persistentStorage: false,
  });
}
