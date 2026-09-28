import { NextResponse } from "next/server";
import { checkLocalPdfStorage } from "@/lib/local-pdf-storage";

export async function GET() {
  try {
    await checkLocalPdfStorage();
    return NextResponse.json({ ok: true, storage: "local PDF storage", provider: "local", persistentStorage: true });
  } catch {
    return NextResponse.json({ ok: false, storage: "local PDF storage unavailable", provider: "local", persistentStorage: false }, { status: 503 });
  }
}
