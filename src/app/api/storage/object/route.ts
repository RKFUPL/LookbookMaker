import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "External PDF mode does not serve stored catalog assets." },
    { status: 410 },
  );
}
