"use client";
/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Grid3X3,
  Maximize,
  Minimize,
  Minus,
  Plus,
  RefreshCw,
  Share2,
  X,
} from "lucide-react";
import type { PageFlip as PageFlipInstance, PageFlipOrientation } from "page-flip";
import type { PublicCatalogDto, PublicCatalogPage } from "@/types/catalog";
import { Brand } from "@/components/Brand";

const MAX_ZOOM = 3;
const MAX_DECODED_PAGES = 12;
const MAX_CACHED_ASSETS = 24;

type ReaderPosition =
  | { type: "cover"; page: number; engineIndex: number }
  | { type: "spread"; leftPage: number | null; rightPage: number | null; engineIndex: number }
  | { type: "back-cover"; page: number; engineIndex: number };

type EnginePage = {
  logicalPage: number | null;
  sourcePage: PublicCatalogPage | null;
  blank: boolean;
};

type BookModel = {
  total: number;
  positions: ReaderPosition[];
  enginePages: EnginePage[];
  positionByEngineIndex: Map<number, number>;
  pageToEngineIndex: Map<number, number>;
  pageToPositionIndex: Map<number, number>;
};

type AssetCacheRecord = {
  image: HTMLImageElement;
  promise: Promise<boolean>;
  ready: boolean;
  lastUsed: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function requestedPageNumber() {
  if (typeof window === "undefined") return 1;
  const page = Number(new URLSearchParams(window.location.search).get("page"));
  return Number.isFinite(page) && page > 0 ? Math.max(1, Math.round(page)) : 1;
}

function buildBookModel(pages: PublicCatalogPage[]): BookModel {
  const sortedPages = [...pages].sort((a, b) => a.page - b.page);
  const total = sortedPages.length;
  const pageMap = new Map(sortedPages.map((page) => [page.page, page]));
  const positions: ReaderPosition[] = [];
  const enginePages: EnginePage[] = [];
  const positionByEngineIndex = new Map<number, number>();
  const pageToEngineIndex = new Map<number, number>();
  const pageToPositionIndex = new Map<number, number>();

  if (!total) return { total, positions, enginePages, positionByEngineIndex, pageToEngineIndex, pageToPositionIndex };

  const coverIndex = enginePages.length;
  enginePages.push({ logicalPage: 1, sourcePage: pageMap.get(1) || sortedPages[0] || null, blank: false });
  positions.push({ type: "cover", page: 1, engineIndex: coverIndex });
  positionByEngineIndex.set(coverIndex, 0);
  pageToEngineIndex.set(1, coverIndex);
  pageToPositionIndex.set(1, 0);

  let nextInteriorPage = 2;
  while (nextInteriorPage <= total - 1) {
    const leftPage = nextInteriorPage + 1 <= total - 1 ? nextInteriorPage : null;
    const rightPage = leftPage === null ? nextInteriorPage : nextInteriorPage + 1;
    const engineIndex = enginePages.length;
    const positionIndex = positions.length;

    // A single interior page belongs on the right side of the final spread.
    // The blank left leaf is required to keep the back cover physically separate.
    enginePages.push({ logicalPage: leftPage, sourcePage: leftPage ? pageMap.get(leftPage) || null : null, blank: leftPage === null });
    enginePages.push({ logicalPage: rightPage, sourcePage: pageMap.get(rightPage) || null, blank: false });
    positions.push({ type: "spread", leftPage, rightPage, engineIndex });
    positionByEngineIndex.set(engineIndex, positionIndex);
    positionByEngineIndex.set(engineIndex + 1, positionIndex);
    if (leftPage !== null) {
      pageToEngineIndex.set(leftPage, engineIndex);
      pageToPositionIndex.set(leftPage, positionIndex);
      pageToEngineIndex.set(rightPage, engineIndex + 1);
      pageToPositionIndex.set(rightPage, positionIndex);
    } else {
      pageToEngineIndex.set(rightPage, engineIndex + 1);
      pageToPositionIndex.set(rightPage, positionIndex);
    }
    nextInteriorPage = leftPage === null ? total : nextInteriorPage + 2;
  }

  if (total > 1) {
    const backIndex = enginePages.length;
    const positionIndex = positions.length;
    enginePages.push({ logicalPage: total, sourcePage: pageMap.get(total) || sortedPages[total - 1] || null, blank: false });
    positions.push({ type: "back-cover", page: total, engineIndex: backIndex });
    positionByEngineIndex.set(backIndex, positionIndex);
    pageToEngineIndex.set(total, backIndex);
    pageToPositionIndex.set(total, positionIndex);
  }

  return { total, positions, enginePages, positionByEngineIndex, pageToEngineIndex, pageToPositionIndex };
}

function positionIndexForEngineIndex(model: BookModel, index: number) {
  if (!model.positions.length) return 0;
  const exact = model.positionByEngineIndex.get(index);
  if (exact !== undefined) return exact;
  let nearest = 0;
  model.positions.forEach((position, positionIndex) => {
    if (position.engineIndex <= index) nearest = positionIndex;
  });
  return nearest;
}

function engineIndexForPage(model: BookModel, pageNumber: number, orientation: PageFlipOrientation) {
  const page = clamp(pageNumber, 1, Math.max(1, model.total));
  if (orientation === "portrait") return model.pageToEngineIndex.get(page) ?? 0;
  const positionIndex = model.pageToPositionIndex.get(page) ?? 0;
  return model.positions[positionIndex]?.engineIndex ?? 0;
}

function visiblePageNumbers(model: BookModel, index: number, orientation: PageFlipOrientation) {
  if (!model.positions.length) return [];
  const position = model.positions[positionIndexForEngineIndex(model, index)];
  if (!position) return [];
  if (position.type === "cover") return [position.page];
  if (position.type === "back-cover") return [position.page];
  if (orientation === "portrait") {
    const page = model.enginePages[index]?.logicalPage;
    if (page !== null && page !== undefined) return [page];
    return position.rightPage !== null ? [position.rightPage] : position.leftPage !== null ? [position.leftPage] : [];
  }
  return [position.leftPage, position.rightPage].filter((page): page is number => page !== null);
}

function pageRangeLabel(model: BookModel, index: number, orientation: PageFlipOrientation) {
  const visible = visiblePageNumbers(model, index, orientation);
  const total = model.total;
  return `${visible.join("–")} / ${total}`;
}

function pageAsset(page: PublicCatalogPage, large: boolean) {
  return large ? page.largeUrl || page.mediumUrl : page.mediumUrl || page.largeUrl;
}

function updatePageUrl(page: number, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("page", String(page));
  const url = `${window.location.pathname}?${params.toString()}`;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function portraitTargetEngineIndex(model: BookModel, currentIndex: number, direction: "next" | "prev") {
  const currentPositionIndex = positionIndexForEngineIndex(model, currentIndex);
  const currentPosition = model.positions[currentPositionIndex];
  if (!currentPosition) return null;

  if (currentPosition.type === "spread") {
    if (direction === "next" && currentPosition.leftPage !== null && currentIndex === currentPosition.engineIndex) {
      return currentPosition.engineIndex + 1;
    }
    if (direction === "prev" && currentPosition.leftPage !== null && currentIndex === currentPosition.engineIndex + 1) {
      return currentPosition.engineIndex;
    }
  }

  const targetPositionIndex = currentPositionIndex + (direction === "next" ? 1 : -1);
  const targetPosition = model.positions[targetPositionIndex];
  if (!targetPosition) return null;
  if (targetPosition.type === "spread") {
    // If the final interior spread has a mathematically required blank leaf,
    // enter it on the real page and leave it the same way.
    return direction === "next" && targetPosition.leftPage === null
      ? targetPosition.engineIndex + 1
      : direction === "prev" && targetPosition.leftPage === null
        ? targetPosition.engineIndex + 1
        : direction === "prev"
          ? targetPosition.engineIndex + 1
          : targetPosition.engineIndex;
  }
  return targetPosition.engineIndex;
}

function dispatchAnalytics(url: string, payload: Record<string, unknown>) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const body = JSON.stringify(payload);

  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      if (accepted) return;
    }
  } catch {
    // Fall through to fetch when Beacon is unavailable.
  }

  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function CatalogViewer({ catalog, preview = false }: { catalog: PublicCatalogDto; preview?: boolean }) {
  const [reader, setReader] = useState<PublicCatalogDto | null>(catalog.pages?.length ? catalog : null);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [orientation, setOrientation] = useState<PageFlipOrientation>("landscape");
  const [flipState, setFlipState] = useState("read");
  const [bookAlignment, setBookAlignment] = useState<ReaderPosition["type"]>("cover");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drawer, setDrawer] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pageInput, setPageInput] = useState(() => String(requestedPageNumber()));

  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const bookHostRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlipInstance | null>(null);
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);
  const pageMediaRefs = useRef<(HTMLDivElement | null)[]>([]);
  const decodedOrderRef = useRef<number[]>([]);
  const hydrateAssetsRef = useRef<(center: number, forceLarge?: boolean) => void>(() => undefined);
  const prepareSpreadRef = useRef<(positionIndex: number) => Promise<boolean>>(async () => true);
  const assetCacheRef = useRef(new Map<string, AssetCacheRecord>());
  const panStartRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const panDraftRef = useRef({ x: 0, y: 0 });
  const panFrameRef = useRef<number | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const pinchDraftRef = useRef<number | null>(null);
  const pinchFrameRef = useRef<number | null>(null);
  const lastTapRef = useRef(0);
  const analyticsSentRef = useRef(new Set<string>());
  const zoomRef = useRef(zoom);
  const navigationPendingRef = useRef(false);
  const historyModeRef = useRef<"push" | "replace">("replace");
  const initializingRef = useRef(true);

  const activeCatalog = reader || catalog;
  const pages = useMemo(() => [...(reader?.pages || [])].sort((a, b) => a.page - b.page), [reader?.pages]);
  const bookModel = useMemo(() => buildBookModel(pages), [pages]);

  useEffect(() => {
    if (catalog.pages?.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/catalogs/${encodeURIComponent(catalog.slug)}/public`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(response.status === 404 ? "This catalog is no longer available." : "The catalog could not be loaded.");
          return response.json() as Promise<{ catalog: PublicCatalogDto }>;
        })
        .then(({ catalog: loaded }) => {
          if (!loaded.pages?.length) throw new Error("This catalog does not contain any readable pages.");
          setReader(loaded);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setLoadError(error instanceof Error ? error.message : "The catalog could not be loaded.");
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalog.pages?.length, catalog.slug, catalogRetry]);

  useEffect(() => {
    if (!pages.length) return;
    const stage = stageRef.current;
    const host = bookHostRef.current;
    if (!stage || !host) return;

    const measureBook = () => {
      const stageStyle = window.getComputedStyle(stage);
      const availableWidth = Math.max(1, stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight));
      const availableHeight = Math.max(1, stage.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom));
      const pageRatio = pages[0].width > 0 && pages[0].height > 0 ? pages[0].width / pages[0].height : 0.707;
      const portrait = window.innerWidth <= 640 || availableWidth < 640;
      const bookRatio = portrait ? pageRatio : pageRatio * 2;
      const width = Math.max(1, Math.min(availableWidth, availableHeight * bookRatio));
      const height = width / bookRatio;
      host.style.width = `${width}px`;
      host.style.height = `${height}px`;
      host.style.aspectRatio = `${bookRatio}`;
      window.requestAnimationFrame(() => flipRef.current?.update());
    };

    measureBook();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureBook) : null;
    observer?.observe(stage);
    window.addEventListener("resize", measureBook, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureBook);
    };
  }, [pages]);

  useEffect(() => {
    if (!pages.length || !bookHostRef.current) return;
    let cancelled = false;
    let instance: PageFlipInstance | null = null;
    const host = bookHostRef.current;
    const activePointers = activePointersRef.current;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { PageFlip } = await import("page-flip");
          if (cancelled) return;

      const mount = document.createElement("div");
      mount.className = "rk-book-engine";
      host.replaceChildren(mount);

      imageRefs.current = [];
      pageMediaRefs.current = [];
      decodedOrderRef.current = [];

      const pageElements = bookModel.enginePages.map((enginePage, index) => {
        const page = enginePage.sourcePage;
        const element = document.createElement("section");
        element.className = "rk-flip-page";
        element.dataset.page = enginePage.logicalPage === null ? "blank" : String(enginePage.logicalPage);
        if (index === 0 || index === bookModel.enginePages.length - 1) element.dataset.density = "hard";
        else element.dataset.density = "soft";

        const media = document.createElement("div");
        media.className = `rk-page-media${enginePage.blank ? " is-blank" : ""}`;
        const pageWidth = page?.width || pages[0].width;
        const pageHeight = page?.height || pages[0].height;
        media.style.setProperty("--page-ratio", `${pageWidth} / ${pageHeight}`);
        pageMediaRefs.current[index] = media;

        const placeholder = document.createElement("div");
        placeholder.className = "rk-page-placeholder";
        placeholder.innerHTML = enginePage.blank ? "" : '<span class="rk-page-mark">RK</span><i></i>';

        const image = page ? document.createElement("img") : null;
        imageRefs.current[index] = image;
        if (image && page) {
          image.alt = `${activeCatalog.title}, page ${page.page}`;
          image.decoding = "async";
          image.draggable = false;
        }

        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "rk-page-retry";
        retry.textContent = "Retry page";
        retry.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!image) return;
          image.dataset.retries = "0";
          image.dataset.asset = "";
          media.classList.remove("has-error", "is-loaded");
          hydrateAssetsRef.current(index, true);
        });

        if (image) {
          image.addEventListener("load", () => {
            image.dataset.retries = "0";
            media.classList.remove("has-error");
            media.classList.add("is-loaded");
          });
          image.addEventListener("error", () => {
            const attempts = Number(image.dataset.retries || 0);
            if (attempts < 2) {
              image.dataset.retries = String(attempts + 1);
              const source = image.dataset.asset || "";
              window.setTimeout(() => {
                if (!source) return;
                image.removeAttribute("src");
                requestAnimationFrame(() => { image.src = source; });
              }, 450 * (attempts + 1));
              return;
            }
            media.classList.remove("is-loaded");
            media.classList.add("has-error");
          });
        }

        for (const product of page?.productLinks || []) {
          try {
            const target = new URL(product.href, window.location.origin);
            if (!['http:', 'https:'].includes(target.protocol)) continue;
            const link = document.createElement("a");
            link.className = "rk-product-hotspot";
            link.href = target.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.style.left = `${product.x ?? 50}%`;
            link.style.top = `${product.y ?? 50}%`;
            link.style.width = `${product.width ?? 20}%`;
            link.style.height = `${product.height ?? 8}%`;
            link.textContent = product.label || "View product";
            media.appendChild(link);
          } catch { /* Ignore invalid product URLs in public content. */ }
        }

        media.prepend(placeholder);
        if (image) media.appendChild(image);
        if (page) media.appendChild(retry);
        element.appendChild(media);
        return element;
      });

      const first = pages[0];
      const ratio = first.width > 0 && first.height > 0 ? first.height / first.width : 1.414;
      const requestedPage = clamp(requestedPageNumber(), 1, bookModel.total);
      const initialOrientation = window.innerWidth <= 640 || (stageRef.current?.clientWidth || window.innerWidth) < 640 ? "portrait" : "landscape";
      const requested = engineIndexForPage(bookModel, requestedPage, initialOrientation);

      instance = new PageFlip(mount, {
        width: 1000,
        height: Math.round(1000 * ratio),
        size: "stretch",
        minWidth: 320,
        maxWidth: 1600,
        minHeight: Math.round(320 * ratio),
        maxHeight: Math.round(1600 * ratio),
        startPage: requested,
        drawShadow: true,
        flippingTime: 780,
        usePortrait: true,
        autoSize: false,
        maxShadowOpacity: 0.34,
        // The first and last engine leaves are real hard covers. Interior leaves
        // remain soft, while the logical model keeps PDF numbering separate.
        showCover: true,
        // page-flip registers a non-passive touch listener only when this is true.
        // The stage's touch-action:none still prevents page scrolling while keeping
        // the library's touch handler compatible with modern browsers.
        mobileScrollSupport: true,
        clickEventForward: true,
        useMouseEvents: true,
        swipeDistance: 24,
        showPageCorners: true,
        disableFlipByClick: false,
      });

      const trimAssetCache = () => {
        while (assetCacheRef.current.size > MAX_CACHED_ASSETS) {
          const oldest = [...assetCacheRef.current.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
          if (!oldest) break;
          assetCacheRef.current.delete(oldest[0]);
        }
      };

      const preloadAsset = (source: string) => {
        if (!source) return Promise.resolve(false);
        const existing = assetCacheRef.current.get(source);
        if (existing) {
          existing.lastUsed = Date.now();
          return existing.promise;
        }

        const image = new Image();
        image.decoding = "async";
        let resolveAsset: (ready: boolean) => void = () => undefined;
        let settled = false;
        const promise = new Promise<boolean>((resolve) => { resolveAsset = resolve; });
        const record: AssetCacheRecord = { image, promise, ready: false, lastUsed: Date.now() };
        assetCacheRef.current.set(source, record);

        const finish = async (ready: boolean) => {
          if (settled) return;
          settled = true;
          if (ready && typeof image.decode === "function") {
            try { await image.decode(); } catch { /* The loaded bitmap is still usable. */ }
          }
          record.ready = ready;
          record.lastUsed = Date.now();
          resolveAsset(ready);
          trimAssetCache();
        };

        image.onload = () => { void finish(true); };
        image.onerror = () => { void finish(false); };
        image.src = source;
        if (image.complete) void finish(image.naturalWidth > 0);
        return promise;
      };

      const spreadIndices = (center: number, engineOrientation: PageFlipOrientation) => {
        const positionIndex = positionIndexForEngineIndex(bookModel, center);
        const position = bookModel.positions[positionIndex];
        if (!position) return [];
        if (engineOrientation === "portrait") return [center];
        if (position.type === "spread") return [position.engineIndex, position.engineIndex + 1];
        return [position.engineIndex];
      };

      const setPageSource = (pageIndex: number, source: string) => {
        const image = imageRefs.current[pageIndex];
        const media = pageMediaRefs.current[pageIndex];
        if (!image || !media || !source || image.dataset.asset === source) return;
        image.dataset.asset = source;
        image.dataset.retries = "0";
        media.classList.remove("has-error");
        image.src = source;
        decodedOrderRef.current = decodedOrderRef.current.filter((value) => value !== pageIndex);
        decodedOrderRef.current.push(pageIndex);
      };

      const primePage = (pageIndex: number, requestLarge: boolean) => {
        const page = bookModel.enginePages[pageIndex]?.sourcePage;
        if (!page) return;
        const previewSource = pageAsset(page, false);
        setPageSource(pageIndex, previewSource);
        void preloadAsset(previewSource).then((ready) => {
          const image = imageRefs.current[pageIndex];
          const media = pageMediaRefs.current[pageIndex];
          if (!ready || !image || !media || image.dataset.asset !== previewSource) return;
          media.classList.add("is-loaded");
        });

        const largeSource = page.largeUrl || previewSource;
        if (!requestLarge || largeSource === previewSource) return;
        void preloadAsset(largeSource).then((ready) => {
          const image = imageRefs.current[pageIndex];
          const media = pageMediaRefs.current[pageIndex];
          if (!ready || !image || !media) return;
          setPageSource(pageIndex, largeSource);
          media.classList.add("is-loaded");
        });
      };

      const loadWindow = (center: number, forceLarge = false) => {
        const engineOrientation = instance?.getOrientation() || (window.innerWidth <= 640 ? "portrait" : "landscape");
        const centerPositionIndex = positionIndexForEngineIndex(bookModel, center);
        const isInitialPage = centerPositionIndex === 0;
        const radiusBefore = isInitialPage ? 0 : (engineOrientation === "landscape" ? 1 : 2);
        const radiusAfter = isInitialPage ? 2 : (engineOrientation === "landscape" ? 2 : 3);
        const desired = new Set<number>();
        for (let positionIndex = Math.max(0, centerPositionIndex - radiusBefore); positionIndex <= Math.min(bookModel.positions.length - 1, centerPositionIndex + radiusAfter); positionIndex += 1) {
          const position = bookModel.positions[positionIndex];
          desired.add(position.engineIndex);
          if (position.type === "spread") desired.add(position.engineIndex + 1);
        }

        const stageWidth = stageRef.current?.clientWidth || window.innerWidth;
        const visibleWidth = engineOrientation === "landscape" ? stageWidth / 2 : stageWidth;
        const highDensity = forceLarge || visibleWidth * window.devicePixelRatio > 1450;
        const active = new Set(spreadIndices(center, engineOrientation));

        for (const pageIndex of desired) {
          primePage(pageIndex, highDensity && active.has(pageIndex));
        }

        let guard = 0;
        while (decodedOrderRef.current.length > MAX_DECODED_PAGES && guard < bookModel.enginePages.length * 2) {
          guard += 1;
          const candidate = decodedOrderRef.current.shift();
          if (candidate === undefined) break;
          if (desired.has(candidate)) {
            decodedOrderRef.current.push(candidate);
            continue;
          }
          const image = imageRefs.current[candidate];
          const media = pageMediaRefs.current[candidate];
          image?.removeAttribute("src");
          if (image) image.dataset.asset = "";
          media?.classList.remove("is-loaded", "has-error");
        }
      };

      const prepareSpread = async (positionIndex: number) => {
        const position = bookModel.positions[positionIndex];
        if (!position) return false;
        const indices = position.type === "spread" ? [position.engineIndex, position.engineIndex + 1] : [position.engineIndex];
        const ready = await Promise.all(indices
          .map((pageIndex) => bookModel.enginePages[pageIndex]?.sourcePage)
          .filter((page): page is PublicCatalogPage => Boolean(page))
          .map((page) => preloadAsset(pageAsset(page, false))));
        return ready.every(Boolean);
      };

      hydrateAssetsRef.current = loadWindow;
      prepareSpreadRef.current = prepareSpread;
      instance.on<number>("flip", ({ data }) => {
        const index = Number(data) || 0;
        const engineOrientation = instance?.getOrientation() || "landscape";
        const position = bookModel.positions[positionIndexForEngineIndex(bookModel, index)];
        const visible = visiblePageNumbers(bookModel, index, engineOrientation);
        const logicalPage = visible[0] || 1;
        setCurrentIndex(index);
        setPageInput(String(logicalPage));
        if (position) setBookAlignment(position.type);
        navigationPendingRef.current = false;
        updatePageUrl(logicalPage, initializingRef.current ? "replace" : historyModeRef.current);
        historyModeRef.current = "push";
        panDraftRef.current = { x: 0, y: 0 };
        setPan({ x: 0, y: 0 });
        loadWindow(index, false);
      });
      instance.on<PageFlipOrientation>("changeOrientation", ({ data }) => {
        setOrientation(data);
        loadWindow(instance?.getCurrentPageIndex() || 0, false);
      });
      instance.on<string>("changeState", ({ data }) => {
        const state = String(data);
        setFlipState(state);
        if (state !== "read") return;
        window.requestAnimationFrame(() => {
          for (const page of pageElements) {
            page.style.removeProperty("transform");
            page.style.removeProperty("transform-origin");
            page.style.removeProperty("clip-path");
            page.style.removeProperty("-webkit-clip-path");
          }
        });
      });
      instance.on<{ page: number; mode: PageFlipOrientation }>("init", ({ data }) => {
        setOrientation(data.mode);
        const targetIndex = engineIndexForPage(bookModel, requestedPageNumber(), data.mode);
        if (instance && instance.getCurrentPageIndex() !== targetIndex) instance.turnToPage(targetIndex);
        const index = instance?.getCurrentPageIndex() || targetIndex;
        const position = bookModel.positions[positionIndexForEngineIndex(bookModel, index)];
        const visible = visiblePageNumbers(bookModel, index, data.mode);
        setCurrentIndex(index);
        setBookAlignment(position?.type || "cover");
        setPageInput(String(visible[0] || 1));
        updatePageUrl(visible[0] || 1, "replace");
        initializingRef.current = false;
        loadWindow(index, false);
      });
      flipRef.current = instance;
      instance.loadFromHTML(pageElements);
        } catch {
          if (!cancelled) setLoadError("The catalog reader could not be initialized.");
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current);
      if (pinchFrameRef.current !== null) window.cancelAnimationFrame(pinchFrameRef.current);
      panFrameRef.current = null;
      pinchFrameRef.current = null;
      activePointers.clear();
      panStartRef.current = null;
      pinchRef.current = null;
      hydrateAssetsRef.current = () => undefined;
      prepareSpreadRef.current = async () => true;
      flipRef.current = null;
      instance?.destroy();
      host.replaceChildren();
    };
  }, [activeCatalog.title, bookModel, pages]);

  useEffect(() => {
    if (!pages.length) return;
    const visible = visiblePageNumbers(bookModel, currentIndex, orientation);
    const page = visible[0] || 1;
    if (preview) return;
    const key = `${activeCatalog.id}:${page}`;
    const timer = window.setTimeout(() => {
      if (analyticsSentRef.current.has(key)) return;
      analyticsSentRef.current.add(key);
      let sessionId = sessionStorage.getItem("rk-reader-session");
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        sessionStorage.setItem("rk-reader-session", sessionId);
      }
      const firstKey = `rk-viewed-${activeCatalog.id}`;
      const type = sessionStorage.getItem(firstKey) ? "page_view" : "view";
      sessionStorage.setItem(firstKey, "1");
      dispatchAnalytics(`/api/catalogs/${activeCatalog.id}/view`, { type, page, sessionId });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeCatalog.id, bookModel, currentIndex, orientation, pages.length, preview]);

  const requestFlip = useCallback((direction: "next" | "prev") => {
    if (!bookModel.positions.length || flipState !== "read" || navigationPendingRef.current) return;
    const currentPositionIndex = positionIndexForEngineIndex(bookModel, currentIndex);
    const targetPositionIndex = currentPositionIndex + (direction === "next" ? 1 : -1);
    const targetPosition = bookModel.positions[targetPositionIndex];
    if (!targetPosition) return;
    const targetEngineIndex = orientation === "portrait"
      ? portraitTargetEngineIndex(bookModel, currentIndex, direction)
      : targetPosition.engineIndex;
    if (targetEngineIndex === null || targetEngineIndex === currentIndex) return;

    navigationPendingRef.current = true;
    historyModeRef.current = "push";
    void prepareSpreadRef.current(targetPositionIndex).then((ready) => {
      if (!ready || !flipRef.current) {
        navigationPendingRef.current = false;
        return;
      }
      setBookAlignment(targetPosition.type);
      if (orientation === "portrait") flipRef.current.flip(targetEngineIndex, "top");
      else if (direction === "next") flipRef.current.flipNext("top");
      else flipRef.current.flipPrev("top");
    });
  }, [bookModel, currentIndex, flipState, orientation]);

  const goToPage = useCallback((pageNumber: number, animate = true, historyMode: "push" | "replace" = "push") => {
    if (!bookModel.total || navigationPendingRef.current) return;
    const targetPage = clamp(Math.round(pageNumber), 1, bookModel.total);
    const targetPositionIndex = bookModel.pageToPositionIndex.get(targetPage) ?? 0;
    const targetPosition = bookModel.positions[targetPositionIndex];
    const target = engineIndexForPage(bookModel, targetPage, orientation);
    if (!targetPosition) return;
    setDrawer(false);
    navigationPendingRef.current = true;
    historyModeRef.current = historyMode;
    void prepareSpreadRef.current(targetPositionIndex).then((ready) => {
      if (!ready) {
        navigationPendingRef.current = false;
        return;
      }
      hydrateAssetsRef.current(target, zoom > 1.2);
      window.setTimeout(() => {
        if (!flipRef.current) {
          navigationPendingRef.current = false;
          return;
        }
        setBookAlignment(targetPosition.type);
        if (animate && target !== currentIndex) flipRef.current.flip(target, "top");
        else flipRef.current.turnToPage(target);
      }, 35);
    });
  }, [bookModel, currentIndex, orientation, zoom]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.matches("input, textarea")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") requestFlip("next");
      if (event.key === "ArrowLeft" || event.key === "PageUp") requestFlip("prev");
      if (event.key === "Home") goToPage(1, false);
       if (event.key === "End" && bookModel.total) goToPage(bookModel.total, false);
      if (event.key === "Escape") setDrawer(false);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [bookModel.total, goToPage, requestFlip]);

  useEffect(() => {
    const onPopState = () => {
      goToPage(requestedPageNumber(), true, "replace");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [goToPage]);

  useEffect(() => {
    function changed() {
      setFullscreen(Boolean(document.fullscreenElement));
      window.setTimeout(() => flipRef.current?.update(), 80);
    }
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !reader) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const value = clamp(zoomRef.current + (event.deltaY < 0 ? 0.18 : -0.18), 1, MAX_ZOOM);
      zoomRef.current = value;
      setZoom(value);
      if (value === 1) {
        panDraftRef.current = { x: 0, y: 0 };
        setPan({ x: 0, y: 0 });
      }
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [reader]);

  useEffect(() => {
    hydrateAssetsRef.current(currentIndex, zoom > 1.2);
  }, [currentIndex, zoom]);

  function submitPage(event: FormEvent) {
    event.preventDefault();
    goToPage(Number(pageInput) || currentIndex + 1, false);
  }

  function changeZoom(next: number) {
    const value = clamp(next, 1, MAX_ZOOM);
    zoomRef.current = value;
    setZoom(value);
    if (value === 1) {
      panDraftRef.current = { x: 0, y: 0 };
      setPan({ x: 0, y: 0 });
    }
  }

  function queuePan(next: { x: number; y: number }) {
    panDraftRef.current = next;
    if (panFrameRef.current !== null) return;
    panFrameRef.current = window.requestAnimationFrame(() => {
      panFrameRef.current = null;
      setPan(panDraftRef.current);
    });
  }

  function queuePinchZoom(next: number) {
    pinchDraftRef.current = clamp(next, 1, MAX_ZOOM);
    if (pinchFrameRef.current !== null) return;
    pinchFrameRef.current = window.requestAnimationFrame(() => {
      pinchFrameRef.current = null;
      const value = pinchDraftRef.current;
      if (value === null) return;
      setZoom(value);
      if (value === 1) {
        panDraftRef.current = { x: 0, y: 0 };
        setPan({ x: 0, y: 0 });
      }
    });
  }

  function pointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      const pointers = activePointersRef.current;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const points = [...pointers.values()];
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        pinchRef.current = { distance: Math.max(distance, 1), zoom };
        panStartRef.current = null;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
      } else if (zoom > 1) {
        event.currentTarget.setPointerCapture(event.pointerId);
        panStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: panDraftRef.current.x, panY: panDraftRef.current.y };
      }
      return;
    }
    if (zoom <= 1 || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    panStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: panDraftRef.current.x, panY: panDraftRef.current.y };
  }

  function pointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      const pointers = activePointersRef.current;
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchRef.current && pointers.size >= 2) {
        const points = [...pointers.values()];
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        event.stopPropagation();
        queuePinchZoom(pinchRef.current.zoom * (distance / pinchRef.current.distance));
        return;
      }
    }
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.stopPropagation();
    queuePan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y });
  }

  function finishPointer(event: ReactPointerEvent<HTMLElement>, cancelled = false) {
    const isTouch = event.pointerType === "touch";
    if (isTouch) {
      activePointersRef.current.delete(event.pointerId);
      if (activePointersRef.current.size < 2) pinchRef.current = null;
    }
    if (panStartRef.current?.pointerId === event.pointerId) {
      event.stopPropagation();
      panStartRef.current = null;
    }
    if (cancelled || !isTouch || activePointersRef.current.size || event.type === "pointercancel") return;
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      event.stopPropagation();
      changeZoom(zoom > 1 ? 1 : 2);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLElement>) {
    finishPointer(event);
  }

  function pointerCancel(event: ReactPointerEvent<HTMLElement>) {
    finishPointer(event, true);
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) await shellRef.current?.requestFullscreen();
    else await document.exitFullscreen();
  }

  async function share() {
    const currentVisible = visiblePageNumbers(bookModel, currentIndex, orientation);
    const url = `${activeCatalog.publicUrl}?page=${currentVisible[0] || 1}`;
    try {
      if (navigator.share) await navigator.share({ title: activeCatalog.title, text: activeCatalog.description, url });
      else {
        await navigator.clipboard.writeText(url);
        setNotice("Link copied");
        window.setTimeout(() => setNotice(""), 1800);
      }
      if (!preview) dispatchAnalytics(`/api/catalogs/${activeCatalog.id}/view`, { type: "share" });
    } catch { /* Sharing was cancelled. */ }
  }

  if (!reader) {
    return (
      <div className="rk-reader-loading">
        <Brand />
        {catalog.coverImageUrl && <img className="rk-reader-cover-preview" src={catalog.coverImageUrl} alt={`${catalog.title} cover`} decoding="async" onError={(event) => event.currentTarget.remove()} />}
        {loadError ? (
          <div className="rk-reader-load-copy"><p>{loadError}</p><button type="button" onClick={() => { setLoadError(""); setCatalogRetry((value) => value + 1); }}><RefreshCw size={15} /> Try again</button></div>
        ) : (
          <div className="rk-reader-load-copy"><i /><p>Loading catalog…</p></div>
        )}
      </div>
    );
  }

  const currentPositionIndex = positionIndexForEngineIndex(bookModel, currentIndex);
  const canPrevious = currentPositionIndex > 0 && flipState === "read";
  const canNext = currentPositionIndex < bookModel.positions.length - 1 && flipState === "read";
  const visible = visiblePageNumbers(bookModel, currentIndex, orientation);

  return (
    <div className={`catalog-viewer rk-reader ${preview ? "preview-viewer" : ""} ${zoom > 1 ? "is-zoomed" : ""}`} ref={shellRef}>
      <header className="rk-reader-header">
        <div className="rk-reader-brand"><Brand /><span>{activeCatalog.collection} · {activeCatalog.season}</span></div>
        <div className="rk-reader-title"><span>{activeCatalog.title}</span>{preview && <em>Staff preview</em>}</div>
        <div className="rk-reader-header-actions">
          {activeCatalog.settings.showBackButton && <button className="rk-reader-icon" type="button" aria-label="Go back" title="Go back" onClick={() => history.back()}><ArrowLeft size={17} /></button>}
          <button className="rk-reader-icon" type="button" aria-label="Share catalog" title="Share" onClick={share}><Share2 size={17} /></button>
          {activeCatalog.settings.allowDownload && activeCatalog.downloadUrl && !preview && <a className="rk-reader-icon" aria-label="Download PDF" title="Download PDF" href={activeCatalog.downloadUrl}><Download size={17} /></a>}
          <button className="rk-reader-icon" type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>
          {preview && <a className="rk-reader-icon" aria-label="Close preview" title="Close preview" href="/admin"><X size={18} /></a>}
        </div>
      </header>

      <main
        className="rk-reader-stage"
        ref={stageRef}
        onPointerDownCapture={pointerDown}
        onPointerMoveCapture={pointerMove}
        onPointerUpCapture={pointerUp}
        onPointerCancelCapture={pointerCancel}
        onDoubleClick={() => changeZoom(zoom > 1 ? 1 : 2)}
      >
        <div className="rk-reader-meta" aria-label="Catalog information">
          <span>{activeCatalog.collection} · {activeCatalog.season}</span>
          <h1>{activeCatalog.title}</h1>
          {activeCatalog.description && <p>{activeCatalog.description}</p>}
        </div>
        <button className="rk-reader-edge rk-reader-edge-left" type="button" aria-label="Previous page" disabled={!canPrevious} onClick={() => requestFlip("prev")}><ChevronLeft size={25} /></button>
        <div className="rk-reader-transform" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}>
          <div className={`rk-book-host ${orientation === "landscape" ? "is-landscape" : "is-portrait"} ${bookAlignment === "cover" ? "is-cover-position" : bookAlignment === "back-cover" ? "is-back-cover-position" : "is-spread-position"}`} ref={bookHostRef} />
        </div>
        <button className="rk-reader-edge rk-reader-edge-right" type="button" aria-label="Next page" disabled={!canNext} onClick={() => requestFlip("next")}><ChevronRight size={25} /></button>
        <div className="rk-reader-hint" aria-hidden="true">Drag the page edge to turn</div>
      </main>

      <footer className="rk-reader-controls">
        <div className="rk-reader-control-group">
          <button className="rk-reader-icon" type="button" aria-label="Open thumbnails" title="Thumbnails" onClick={() => setDrawer((value) => !value)}><Grid3X3 size={17} /></button>
          <button className="rk-reader-icon rk-fit-control" type="button" aria-label="Fit to screen" title="Fit to screen" onClick={() => changeZoom(1)}><Expand size={16} /></button>
        </div>
        <div className="rk-reader-pagination">
          <button className="rk-reader-icon" type="button" aria-label="Previous page" onClick={() => requestFlip("prev")} disabled={!canPrevious}><ChevronLeft size={20} /></button>
          <form onSubmit={submitPage} title="Enter a page number">
            <input aria-label="Go to page" inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, "").slice(0, 4))} onBlur={() => { setPageInput(String(visible[0] || 1)); }} />
            <span>{orientation === "landscape" && visible.length > 1 ? `–${visible[1]}` : ""} / {pages.length}</span>
          </form>
          <button className="rk-reader-icon" type="button" aria-label="Next page" onClick={() => requestFlip("next")} disabled={!canNext}><ChevronRight size={20} /></button>
        </div>
        <div className="rk-reader-control-group rk-reader-zoom-controls">
          <button className="rk-reader-icon" type="button" aria-label="Zoom out" title="Zoom out" onClick={() => changeZoom(zoom - .25)} disabled={zoom <= 1}><Minus size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="rk-reader-icon" type="button" aria-label="Zoom in" title="Zoom in" onClick={() => changeZoom(zoom + .25)} disabled={zoom >= MAX_ZOOM}><Plus size={16} /></button>
        </div>
      </footer>

      <aside className={`rk-thumbnail-drawer ${drawer ? "is-open" : ""}`} aria-hidden={!drawer}>
        <div className="rk-thumbnail-heading">
          <div><span>Pages</span><h2>{activeCatalog.title}</h2><p>{pageRangeLabel(bookModel, currentIndex, orientation)}</p></div>
          <button className="rk-reader-icon" type="button" aria-label="Close thumbnails" onClick={() => setDrawer(false)}><X size={18} /></button>
        </div>
        {drawer && <div className="rk-thumbnail-grid">{pages.map((page) => <button type="button" className={visible.includes(page.page) ? "is-active" : ""} key={page.page} onClick={() => goToPage(page.page, false)}><span style={{ aspectRatio: `${page.width}/${page.height}` }}><img src={page.thumbnailUrl} alt={`Page ${page.page}`} loading="lazy" decoding="async" /></span><em>{String(page.page).padStart(2, "0")}</em></button>)}</div>}
      </aside>
      {drawer && <button className="rk-drawer-scrim" type="button" aria-label="Close thumbnails" onClick={() => setDrawer(false)} />}
      {notice && <div className="rk-reader-toast">{notice}</div>}
    </div>
  );
}
