import { ApiError } from "@/lib/http";

export async function validateUpload(file: File, maxBytes: number) {
  if (!file.name.toLowerCase().endsWith(".pdf") || !["application/pdf", "application/octet-stream", ""].includes(file.type)) {
    throw new ApiError(400, "Only PDF files can be uploaded.", "INVALID_PDF_UPLOAD");
  }
  if (file.size <= 0 || file.size > maxBytes) throw new ApiError(413, `PDF uploads must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`, "PDF_TOO_LARGE");
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(bytes) !== "%PDF-") throw new ApiError(400, "The uploaded file is not a valid PDF.", "INVALID_PDF_UPLOAD");
}
