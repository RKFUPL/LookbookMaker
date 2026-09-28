export function pdfViewerErrorMessage(error: unknown, fallback = "Unable to load this lookbook.") {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b404\b|not found|source could not be found|source pdf url configured/i.test(message)) return "Catalog source could not be found.";
  if (/timed out/i.test(message)) return "The PDF source took too long to respond. Check the source link and try again.";
  if (/unexpected server response|\b502\b|invalid pdf/i.test(message)) return "The configured source did not return a valid PDF. Use a direct downloadable PDF link.";
  return /worker/i.test(message) ? "PDF viewer failed to initialize." : fallback;
}
