import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { requireStaff } from "@/lib/auth";
import { getWorkDriveConfigurationStatus, testWorkDriveConnection } from "@/lib/workdrive";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireStaff();
    const configuration = getWorkDriveConfigurationStatus();
    if (!configuration.hasClientId || !configuration.hasClientSecret || !configuration.hasRefreshToken || !configuration.hasRootFolder) {
      return NextResponse.json({ status: "not_connected", configuration, error: `WorkDrive is not configured. Missing: ${configuration.missingVariables.join(", ")}.`, code: "WORKDRIVE_NOT_CONFIGURED" });
    }
    try {
      const connection = await testWorkDriveConnection();
      return NextResponse.json({ status: "connected", configuration, connection });
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as Error & { code?: string }).code) : "WORKDRIVE_CONNECTION_FAILED";
      return NextResponse.json({ status: code === "WORKDRIVE_AUTH_FAILED" ? "connection_expired" : "connection_error", configuration, error: error instanceof Error ? error.message : "WorkDrive connection test failed.", code }, { status: 200 });
    }
  } catch (error) {
    return apiError(error);
  }
}

export async function POST() {
  try {
    await requireStaff();
    const connection = await testWorkDriveConnection();
    return NextResponse.json({ status: "connected", connection });
  } catch (error) {
    return apiError(error);
  }
}
