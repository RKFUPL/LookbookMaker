export function isCatalogViewPageValid(page: number | undefined, pageCount: number) {
  return page === undefined || pageCount <= 0 || page <= pageCount;
}
