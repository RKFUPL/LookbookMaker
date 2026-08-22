import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message || "Please check the submitted fields.";
    return NextResponse.json(
      { error: message, code: "VALIDATION_ERROR", details: error.flatten() },
      { status: 400 },
    );
  }
  if (error instanceof Error && error.name === "MongoServerError" && "code" in error && error.code === 11000) {
    return NextResponse.json({ error: "A catalog with this URL already exists." }, { status: 409 });
  }
  console.error(error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON request.", "INVALID_JSON");
  }
}
