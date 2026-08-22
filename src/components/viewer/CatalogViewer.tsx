"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Expand, Grid3X3, Maximize, Minimize, Minus, Plus, RefreshCw, Share2, X } from "lucide-react";
import type { PageFlip as PageFlipInstance, PageFlipOrientation } from "page-flip";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PublicCatalogDto } from "@/types/catalog";
import { Brand } from "@/components/Brand";

const MAX_ZOOM = 3;
const MAX_CACHE = 12;
const PDF_ERROR = "Unable to load this lookbook.";
const PAGE_ERROR = "Unable to render page 1.";
const WORKER_ERROR = "PDF viewer failed to initialize.";
type PdfStage = "idle" | "loading-document" | "document-ready" | "loading-page" | "rendering-page" | "rendered" | "error";

type BitmapRecord = { canvas: HTMLCanvasElement; lastUsed: number; key: string };
type PdfPageSize = { width: number; height: number };
type ViewerLayout = { stageWidth: number; stageHeight: number; bookWidth: number; bookHeight: number; pageWidth: number; pageHeight: number };
type PdfLoadEntry = { key: string; task: PDFDocumentLoadingTask | null; promise: Promise<PDFDocumentProxy>; cancelled: boolean };

function pdfLog(event: string, details?: Record<string, unknown>, error?: unknown) {
  const payload = { event, ...(details || {}) };
  const prefix = event.endsWith("ERROR") ? "[RK PDF ERROR]" : "[RK PDF]";
  if (event.endsWith("ERROR")) {
    console.error(prefix, payload, error);
  } else if (process.env.NODE_ENV !== "production") {
    console.info(prefix, payload);
  }
}
function viewerLog(event: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") console.info("[RK VIEWER]", { event, ...(details || {}) });
}
function disposePdfDocument(document: PDFDocumentProxy | null) {
  if (document) void document.cleanup().catch((error) => pdfLog("PDF LOAD ERROR", { phase: "cleanup" }, error));
}
function disposeLoadingTask(task: PDFDocumentLoadingTask | null) {
  if (task) void task.destroy().catch((error) => pdfLog("PDF LOAD ERROR", { phase: "destroy" }, error));
}
function userFacingPdfError(error: unknown, fallback = PDF_ERROR) {
  const message = error instanceof Error ? error.message : String(error);
  return /worker/i.test(message) ? WORKER_ERROR : fallback;
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function requestedPage() {
  if (typeof window === "undefined") return 1;
  const value = Number(new URLSearchParams(window.location.search).get("page"));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}
function updatePageUrl(page: number, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("page", String(page));
  const url = `${window.location.pathname}?${params.toString()}`;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}
function dispatchAnalytics(url: string, payload: Record<string, unknown>) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
  } catch { /* A non-blocking metric must never interrupt reading. */ }
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

export function CatalogViewer({ catalog, preview = false }: { catalog: PublicCatalogDto; preview?: boolean }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState<PdfPageSize | null>(null);
  const [coverReady, setCoverReady] = useState(false);
  const [pdfStage, setPdfStage] = useState<PdfStage>("idle");
  const [layoutReady, setLayoutReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadDiagnostic, setLoadDiagnostic] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [orientation, setOrientation] = useState<PageFlipOrientation>("landscape");
  const [flipState, setFlipState] = useState("read");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drawer, setDrawer] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pageInput, setPageInput] = useState(String(requestedPage()));
  const [retryKey, setRetryKey] = useState(0);

  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const coverCanvasRef = useRef<HTMLCanvasElement>(null);
  const flipRef = useRef<PageFlipInstance | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const mediaRefs = useRef<(HTMLDivElement | null)[]>([]);
  const thumbRefs = useRef(new Map<number, HTMLCanvasElement>());
  const bitmapCache = useRef(new Map<string, BitmapRecord>());
  const renderPromises = useRef(new Map<string, Promise<HTMLCanvasElement>>());
  const pagePromises = useRef(new Map<number, Promise<PDFPageProxy>>());
  const pageDimensions = useRef(new Map<number, PdfPageSize>());
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const pdfLoadRef = useRef<PdfLoadEntry | null>(null);
  const loadLifecycleRef = useRef(0);
  const renderGeneration = useRef(0);
  const layoutRef = useRef<ViewerLayout | null>(null);
  const hydrateRef = useRef<(center: number) => void>(() => undefined);
  const navigationPending = useRef(false);
  const zoomRef = useRef(zoom);
  const panDraft = useRef({ x: 0, y: 0 });
  const panStart = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const lastTap = useRef(0);
  const analyticsSent = useRef(new Set<string>());

  const total = Math.max(0, pageCount);
  const visiblePages = useMemo(() => {
    if (!total) return [];
    const first = currentIndex === 0 ? 1 : orientation === "landscape" ? currentIndex : currentIndex + 1;
    const second = orientation === "landscape" && currentIndex > 0 && currentIndex + 1 < total ? currentIndex + 1 : null;
    return [first, second].filter((page): page is number => Boolean(page && page <= total));
  }, [currentIndex, orientation, total]);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const clearCache = useCallback(() => {
    renderGeneration.current += 1;
    for (const record of bitmapCache.current.values()) {
      record.canvas.width = 0;
      record.canvas.height = 0;
    }
    bitmapCache.current.clear();
    renderPromises.current.clear();
  }, []);

  const getPage = useCallback(async (pageNumber: number) => {
    if (!pdf) throw new Error("PDF is not ready.");
    const existing = pagePromises.current.get(pageNumber);
    if (existing) return existing;
    const promise = (async () => {
      pdfLog("PAGE LOAD START", { pageNumber });
      try {
        const page = await pdf.getPage(pageNumber);
        pdfLog("PAGE LOAD SUCCESS", { pageNumber });
        return page;
      } catch (error) {
        pagePromises.current.delete(pageNumber);
        pdfLog("PAGE LOAD ERROR", { pageNumber }, error);
        throw error;
      }
    })();
    pagePromises.current.set(pageNumber, promise);
    return promise;
  }, [pdf]);

  const getPageDimensions = useCallback(async (pageNumber: number) => {
    const cached = pageDimensions.current.get(pageNumber);
    if (cached) return cached;
    const page = await getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const dimensions = { width: viewport.width, height: viewport.height };
    pageDimensions.current.set(pageNumber, dimensions);
    return dimensions;
  }, [getPage]);

  const evictCache = useCallback(() => {
    while (bitmapCache.current.size > MAX_CACHE) {
      const oldest = [...bitmapCache.current.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!oldest) break;
      oldest.canvas.width = 0;
      oldest.canvas.height = 0;
      bitmapCache.current.delete(oldest.key);
    }
  }, []);

  const renderBitmap = useCallback((pageNumber: number, quality: "page" | "thumb") => {
    const key = `${pageNumber}:${quality}:${quality === "thumb" ? "0.32" : Math.min(1.65, 0.65 + 0.3 * zoomRef.current).toFixed(2)}`;
    const cached = bitmapCache.current.get(key);
    if (cached) { cached.lastUsed = Date.now(); return Promise.resolve(cached.canvas); }
    const active = renderPromises.current.get(key);
    if (active) return active;
    const generation = renderGeneration.current;
    const promise = (async () => {
      try {
        const page = await getPage(pageNumber);
        // Keep the startup canvases close to the reader's display resolution; zoomed
        // pages get a higher-quality representation without rendering 8K surfaces.
        const scale = quality === "thumb" ? 0.32 : Math.min(1.65, 0.65 + 0.3 * zoomRef.current);
        const viewport = page.getViewport({ scale });
        pageDimensions.current.set(pageNumber, { width: viewport.width / scale, height: viewport.height / scale });
        const outputScale = quality === "thumb" ? 1 : Math.min(1.25, window.devicePixelRatio || 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas rendering is unavailable.");
        pdfLog("START RENDER PAGE", { pageNumber, quality, scale, outputScale });
        pdfLog("PAGE RENDER START", { pageNumber, quality, scale, outputScale });
        await page.render({ canvas, canvasContext: context, viewport, transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined }).promise;
        if (generation !== renderGeneration.current) throw new Error("PDF render was cancelled.");
        bitmapCache.current.set(key, { canvas, lastUsed: Date.now(), key });
        evictCache();
        pdfLog("PAGE RENDERED", { pageNumber, quality, width: canvas.width, height: canvas.height });
        pdfLog("PAGE RENDER SUCCESS", { pageNumber, quality, width: canvas.width, height: canvas.height });
        return canvas;
      } catch (error) {
        pdfLog("PAGE RENDER ERROR", { pageNumber, quality, key }, error);
        throw error;
      } finally {
        renderPromises.current.delete(key);
      }
    })();
    renderPromises.current.set(key, promise);
    return promise;
  }, [evictCache, getPage]);

  const paintCanvas = useCallback(async (pageNumber: number, canvas: HTMLCanvasElement, quality: "page" | "thumb") => {
    try {
      const source = await renderBitmap(pageNumber, quality);
      canvas.width = source.width;
      canvas.height = source.height;
      pdfLog("CANVAS SIZE", { pageNumber, quality, width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight });
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0);
      canvas.style.display = "block";
      canvas.style.visibility = "visible";
      canvas.style.opacity = "1";
      const media = canvas.closest<HTMLDivElement>(".rk-page-media");
      const dimensions = pageDimensions.current.get(pageNumber);
      if (media && dimensions) media.style.setProperty("--page-ratio", `${dimensions.width} / ${dimensions.height}`);
      canvas.style.objectFit = "contain";
      media?.classList.add("is-loaded");
      const rect = canvas.getBoundingClientRect();
      const mediaRect = media?.getBoundingClientRect();
      pdfLog("CANVAS IN DOM", {
        pageNumber,
        quality,
        isConnected: canvas.isConnected,
        display: getComputedStyle(canvas).display,
        visibility: getComputedStyle(canvas).visibility,
        opacity: getComputedStyle(canvas).opacity,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        rectWidth: rect.width,
        rectHeight: rect.height,
        containerWidth: mediaRect?.width || 0,
        containerHeight: mediaRect?.height || 0,
      });
      return true;
    } catch (error) {
      if (pageNumber === 1 && quality === "page") {
        setPdfStage("error");
        setLoadError(PAGE_ERROR);
      }
      pdfLog("PAGE RENDER ERROR", { pageNumber, quality, phase: "paint" }, error);
      return false;
    }
  }, [renderBitmap]);

  const hydrateWindow = useCallback((center: number) => {
    if (!pdf || !total) return;
    const start = Math.max(1, center + 1 - (center === 0 ? 0 : 2));
    const end = Math.min(total, center + 1 + (center === 0 ? 2 : 3));
    for (let page = start; page <= end; page += 1) {
      const canvas = canvasRefs.current[page - 1];
      if (canvas) {
        const media = canvas.closest<HTMLDivElement>(".rk-page-media");
        const dimensions = pageDimensions.current.get(page);
        if (media && dimensions) media.style.setProperty("--page-ratio", `${dimensions.width} / ${dimensions.height}`);
        canvas.style.objectFit = "contain";
        const rect = media?.getBoundingClientRect();
        viewerLog("PAGE CONTAINER", { pageNumber: page, width: rect?.width || 0, height: rect?.height || 0, isConnected: canvas.isConnected });
        void paintCanvas(page, canvas, "page");
      }
      // Keep the adjacent pages warm without blocking the visible spread.
      if (Math.abs(page - (center + 1)) > 1) void renderBitmap(page, "page");
    }
  }, [pdf, paintCanvas, renderBitmap, total]);

  useEffect(() => { hydrateRef.current = hydrateWindow; }, [hydrateWindow]);

  useEffect(() => {
    const loadKey = `${catalog.id}:${retryKey}`;
    const lifecycle = loadLifecycleRef.current + 1;
    loadLifecycleRef.current = lifecycle;
    let cancelled = false;
    const promises = pagePromises.current;
    const dimensions = pageDimensions.current;
    // The loading state belongs to the asynchronous PDF task, not to server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setPdfStage("loading-document");
    setLoadError("");
    setLoadDiagnostic("");
    setPdf(null);
    setPageCount(0);
    setPageSize(null);
    setCoverReady(false);
    setLayoutReady(false);
    const previous = pdfLoadRef.current;
    if (previous && previous.key !== loadKey) {
      previous.cancelled = true;
      disposeLoadingTask(previous.task);
      pdfLoadRef.current = null;
      disposePdfDocument(pdfDocumentRef.current);
      pdfDocumentRef.current = null;
      clearCache();
      pagePromises.current.clear();
      pageDimensions.current.clear();
    }
    let entry = pdfLoadRef.current;
    void (async () => {
      try {
        if (!entry || entry.key !== loadKey) {
          pdfLog("PDF LOAD START", { catalogId: catalog.id, url: `/api/catalogs/${catalog.id}/pdf` });
          pdfLog("START DOCUMENT LOAD", { catalogId: catalog.id, url: `/api/catalogs/${catalog.id}/pdf` });
          const nextEntry = { key: loadKey, task: null, cancelled: false } as PdfLoadEntry;
          nextEntry.promise = (async () => {
            const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
            const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
            GlobalWorkerOptions.workerSrc = workerSrc;
            pdfLog("PDF WORKER READY", { workerSrc });
            const task = getDocument({ url: `/api/catalogs/${catalog.id}/pdf`, rangeChunkSize: 65536, disableAutoFetch: false, disableStream: false, withCredentials: false });
            nextEntry.task = task;
            if (nextEntry.cancelled) {
              await task.destroy();
              throw new Error("PDF load was cancelled.");
            }
            return task.promise;
          })();
          entry = nextEntry;
          pdfLoadRef.current = nextEntry;
        }
        const document = await entry.promise;
        if (cancelled || entry.cancelled || loadLifecycleRef.current !== lifecycle) return;
        pdfDocumentRef.current = document;
        setPdf(document);
        setPageCount(document.numPages);
        setLoading(false);
        setPdfStage("document-ready");
        pdfLog("DOCUMENT LOADED", { catalogId: catalog.id });
        pdfLog("PAGE COUNT", { catalogId: catalog.id, numPages: document.numPages });
        pdfLog("PDF LOAD SUCCESS", { catalogId: catalog.id, numPages: document.numPages });
      } catch (error) {
        if (cancelled || loadLifecycleRef.current !== lifecycle) return;
        setLoading(false);
        setPdfStage("error");
        setLoadError(userFacingPdfError(error));
        if (process.env.NODE_ENV !== "production") setLoadDiagnostic(error instanceof Error ? error.message : String(error));
        pdfLog("PDF LOAD ERROR", { catalogId: catalog.id }, error);
      }
    })();
    return () => {
      cancelled = true;
      window.setTimeout(() => {
        if (loadLifecycleRef.current !== lifecycle) return;
        const active = pdfLoadRef.current;
        if (active?.key === loadKey) {
          active.cancelled = true;
          disposeLoadingTask(active.task);
          pdfLoadRef.current = null;
        }
        disposePdfDocument(pdfDocumentRef.current);
        pdfDocumentRef.current = null;
        clearCache();
        promises.clear();
        dimensions.clear();
      }, 0);
    };
  }, [catalog.id, clearCache, retryKey]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    // The page state mirrors the asynchronous PDF.js request below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPdfStage("loading-page");
    void (async () => {
      try {
        pdfLog("START PAGE 1", { pageNumber: 1 });
        await getPage(1);
        pdfLog("PAGE 1 LOADED", { pageNumber: 1 });
        const dimensions = await getPageDimensions(1);
        pdfLog("VIEWPORT", { pageNumber: 1, width: dimensions.width, height: dimensions.height, scale: 1 });
        if (cancelled) return;
        setPageSize(dimensions);
      } catch (error) {
        if (cancelled) return;
        setLoadError(PAGE_ERROR);
        if (process.env.NODE_ENV !== "production") setLoadDiagnostic(error instanceof Error ? error.message : String(error));
        pdfLog("PAGE RENDER ERROR", { pageNumber: 1, phase: "cover" }, error);
      }
    })();
    return () => { cancelled = true; };
  }, [getPage, getPageDimensions, pdf]);

  useEffect(() => {
    if (!pdf || !pageSize || !coverCanvasRef.current) return;
    let cancelled = false;
    const canvas = coverCanvasRef.current;
    void (async () => {
      try {
        setPdfStage("rendering-page");
        const source = await renderBitmap(1, "page");
        if (cancelled) return;
        canvas.width = source.width;
        canvas.height = source.height;
        pdfLog("CANVAS SIZE", { pageNumber: 1, quality: "cover", width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight });
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas rendering is unavailable.");
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0);
        canvas.style.display = "block";
        canvas.style.visibility = "visible";
        canvas.style.opacity = "1";
        const rect = canvas.getBoundingClientRect();
        if (canvas.width <= 0 || canvas.height <= 0 || rect.width <= 0 || rect.height <= 0) {
          throw new Error("Page 1 rendered with zero dimensions.");
        }
        pdfLog("CANVAS IN DOM", {
          pageNumber: 1,
          quality: "cover",
          isConnected: canvas.isConnected,
          display: getComputedStyle(canvas).display,
          visibility: getComputedStyle(canvas).visibility,
          opacity: getComputedStyle(canvas).opacity,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
          rectWidth: rect.width,
          rectHeight: rect.height,
        });
        setCoverReady(true);
        setPdfStage("rendered");
        viewerLog("COVER READY", { width: rect.width, height: rect.height, canvasWidth: canvas.width, canvasHeight: canvas.height });
      } catch (error) {
        if (cancelled) return;
        setLoadError(PAGE_ERROR);
        if (process.env.NODE_ENV !== "production") setLoadDiagnostic(error instanceof Error ? error.message : String(error));
        pdfLog("PAGE RENDER ERROR", { pageNumber: 1, phase: "cover" }, error);
      }
    })();
    return () => { cancelled = true; };
  }, [pageSize, pdf, renderBitmap]);

  useEffect(() => {
    if (!pdf || !coverReady || !pageSize || !layoutReady || !layoutRef.current || !hostRef.current || !total) return;
    let cancelled = false;
    let instance: PageFlipInstance | null = null;
    const host = hostRef.current;
    const layout = layoutRef.current;
    host.style.width = `${layout.bookWidth}px`;
    host.style.height = `${layout.bookHeight}px`;
    host.style.aspectRatio = String(layout.bookWidth / layout.bookHeight);
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0) {
      viewerLog("LAYOUT WAITING", { bookWidth: hostRect.width, bookHeight: hostRect.height });
      return;
    }
    const mount = document.createElement("div");
    mount.className = "rk-book-engine";
    mount.style.width = `${layout.bookWidth}px`;
    mount.style.height = `${layout.bookHeight}px`;
    host.replaceChildren(mount);
    canvasRefs.current = [];
    mediaRefs.current = [];
    const elements = Array.from({ length: total }, (_, index) => {
      const pageNumber = index + 1;
      const element = document.createElement("section");
      element.className = "rk-flip-page";
      element.style.width = `${layout.pageWidth}px`;
      element.style.height = `${layout.pageHeight}px`;
      element.dataset.page = String(pageNumber);
      if (index === 0 || index === total - 1) element.dataset.density = "hard";
      const media = document.createElement("div");
      media.className = "rk-page-media";
      media.style.setProperty("--page-ratio", `${pageSize.width} / ${pageSize.height}`);
      const placeholder = document.createElement("div");
      placeholder.className = "rk-page-placeholder";
      placeholder.innerHTML = '<span class="rk-page-mark">RK</span><i></i>';
      const canvas = document.createElement("canvas");
      canvas.className = "rk-page-canvas";
      canvas.setAttribute("aria-label", `${catalog.title}, page ${pageNumber}`);
      canvasRefs.current[index] = canvas;
      mediaRefs.current[index] = media;
      media.append(placeholder, canvas);
      element.appendChild(media);
      return element;
    });
    const start = clamp(requestedPage() - 1, 0, total - 1);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { PageFlip } = await import("page-flip");
          if (cancelled) return;
          const ratio = layout.pageHeight / layout.pageWidth;
          instance = new PageFlip(mount, {
            width: Math.max(1, Math.round(layout.pageWidth)),
            height: Math.max(1, Math.round(layout.pageHeight)),
            size: "stretch",
            minWidth: 280,
            maxWidth: 1600,
            minHeight: Math.round(280 * ratio),
            maxHeight: Math.round(1600 * ratio),
            startPage: start,
            drawShadow: true,
            flippingTime: 760,
            usePortrait: true,
            autoSize: false,
            maxShadowOpacity: 0.34,
            showCover: true,
            mobileScrollSupport: true,
            clickEventForward: true,
            useMouseEvents: true,
            swipeDistance: 24,
            showPageCorners: true,
          });
          instance.on<number>("flip", ({ data }) => {
            setCurrentIndex(data);
            const page = Math.min(total, Math.max(1, data + 1));
            setPageInput(String(page));
            updatePageUrl(page, "push");
            navigationPending.current = false;
            hydrateRef.current(data);
          });
          instance.on<PageFlipOrientation>("changeOrientation", ({ data }) => { setOrientation(data); instance?.update(); });
          instance.on<string>("changeState", ({ data }) => { setFlipState(String(data)); if (data === "read") navigationPending.current = false; });
          instance.on<{ mode: PageFlipOrientation }>("init", ({ data }) => {
            setOrientation(data.mode);
            const initial = instance?.getCurrentPageIndex() || start;
            setCurrentIndex(initial);
            const page = Math.min(total, initial + 1);
            setPageInput(String(page));
            updatePageUrl(page, "replace");
            let readyAttempts = 0;
            const verifyReady = () => {
              if (cancelled) return;
              const canvas = canvasRefs.current[initial];
              const rect = canvas?.closest(".rk-page-media")?.getBoundingClientRect();
              if (!rect || rect.width <= 0 || rect.height <= 0) {
                if (readyAttempts === 0) viewerLog("LAYOUT WAITING", { pageNumber: page, containerWidth: rect?.width || 0, containerHeight: rect?.height || 0 });
                readyAttempts += 1;
                instance?.update();
                if (readyAttempts < 12) window.requestAnimationFrame(verifyReady);
                else window.setTimeout(verifyReady, 100);
                return;
              }
              viewerLog("FLIPBOOK READY", { pageNumber: page, containerWidth: rect.width, containerHeight: rect.height, canvasConnected: Boolean(canvas?.isConnected) });
              hydrateRef.current(initial);
            };
            window.requestAnimationFrame(verifyReady);
          });
          flipRef.current = instance;
          instance.loadFromHTML(elements);
        } catch (error) {
          if (!cancelled) {
            setLoadError("The catalog reader could not be initialized.");
            setPdfStage("error");
            pdfLog("PAGE RENDER ERROR", { phase: "flipbook" }, error);
          }
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      flipRef.current = null;
      instance?.destroy();
      host.replaceChildren();
    };
  }, [catalog.title, coverReady, layoutReady, pageSize, pdf, total]);

  useEffect(() => {
    if (!total || !pageSize || !stageRef.current || !hostRef.current) return;
    const stage = stageRef.current;
    const host = hostRef.current;
    const measure = () => {
      const stageRect = stage.getBoundingClientRect();
      const stageWidth = Math.round(stageRect.width);
      const stageHeight = Math.round(stageRect.height);
      viewerLog("READER STAGE", { width: stageWidth, height: stageHeight, top: stageRect.top, left: stageRect.left });
      if (stageWidth <= 0 || stageHeight <= 0) {
        layoutRef.current = null;
        setLayoutReady(false);
        return;
      }
      const availableWidth = Math.max(0, stageWidth - 110);
      const availableHeight = Math.max(0, stageHeight - 34);
      if (availableWidth <= 0 || availableHeight <= 0) {
        layoutRef.current = null;
        setLayoutReady(false);
        return;
      }
      const ratio = pageSize.width / pageSize.height;
      const portrait = window.innerWidth <= 640 || availableWidth < 640;
      const bookRatio = portrait ? ratio : ratio * 2;
      const bookWidth = Math.max(1, Math.min(availableWidth, availableHeight * bookRatio));
      const bookHeight = Math.max(1, bookWidth / bookRatio);
      const nextLayout: ViewerLayout = {
        stageWidth,
        stageHeight,
        bookWidth,
        bookHeight,
        pageWidth: portrait ? bookWidth : bookWidth / 2,
        pageHeight: bookHeight,
      };
      layoutRef.current = nextLayout;
      viewerLog("BOOK", { width: bookWidth, height: bookHeight, pageWidth: nextLayout.pageWidth, pageHeight: nextLayout.pageHeight, portrait });
      host.style.width = `${bookWidth}px`;
      host.style.height = `${bookHeight}px`;
      host.style.aspectRatio = String(bookRatio);
      flipRef.current?.update();
      hydrateRef.current(flipRef.current?.getCurrentPageIndex() || 0);
      setLayoutReady(true);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(stage);
    window.addEventListener("resize", measure, { passive: true });
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [pageSize, total]);

  useEffect(() => {
    if (!drawer || !pdf) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as HTMLCanvasElement;
        const page = Number(canvas.dataset.page);
        if (page) void paintCanvas(page, canvas, "thumb");
        observer.unobserve(canvas);
      }
    }, { root: document.querySelector(".rk-thumbnail-grid"), rootMargin: "220px" });
    thumbRefs.current.forEach((canvas) => observer.observe(canvas));
    return () => observer.disconnect();
  }, [drawer, pageCount, paintCanvas, pdf]);

  const goToPage = useCallback((page: number, animate = true) => {
    if (!flipRef.current || !total || navigationPending.current) return;
    const target = clamp(Math.round(page), 1, total) - 1;
    navigationPending.current = true;
    setDrawer(false);
    hydrateRef.current(target);
    if (animate) flipRef.current.flip(target, "top"); else flipRef.current.turnToPage(target);
  }, [total]);

  const requestFlip = useCallback((direction: "next" | "prev") => {
    if (!flipRef.current || flipState !== "read" || navigationPending.current) return;
    navigationPending.current = true;
    if (direction === "next") flipRef.current.flipNext("top"); else flipRef.current.flipPrev("top");
  }, [flipState]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.matches("input, textarea")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") requestFlip("next");
      if (event.key === "ArrowLeft" || event.key === "PageUp") requestFlip("prev");
      if (event.key === "Home") goToPage(1, false);
      if (event.key === "End") goToPage(total, false);
      if (event.key === "Escape") setDrawer(false);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [goToPage, requestFlip, total]);

  useEffect(() => {
    const onPopState = () => goToPage(requestedPage(), false);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [goToPage]);

  useEffect(() => {
    const changed = () => { setFullscreen(Boolean(document.fullscreenElement)); window.setTimeout(() => flipRef.current?.update(), 80); };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pdf) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); setZoom((value) => clamp(value + (event.deltaY < 0 ? 0.18 : -0.18), 1, MAX_ZOOM)); };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [pdf]);

  useEffect(() => { hydrateRef.current(currentIndex); }, [currentIndex, zoom]);

  useEffect(() => {
    if (preview || !total) return;
    const page = visiblePages[0] || 1;
    const key = `${catalog.id}:${page}`;
    const timer = window.setTimeout(() => {
      if (analyticsSent.current.has(key)) return;
      analyticsSent.current.add(key);
      const storageKey = `rk-viewed-${catalog.id}`;
      const type = sessionStorage.getItem(storageKey) ? "page_view" : "view";
      sessionStorage.setItem(storageKey, "1");
      dispatchAnalytics(`/api/catalogs/${catalog.id}/view`, { type, page });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [catalog.id, currentIndex, preview, total, visiblePages]);

  function changeZoom(value: number) {
    const next = clamp(value, 1, MAX_ZOOM);
    setZoom(next);
    if (next === 1) { panDraft.current = { x: 0, y: 0 }; setPan({ x: 0, y: 0 }); }
  }
  function pointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2) {
        const points = [...pointers.current.values()];
        pinch.current = { distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)), zoom };
        panStart.current = null;
      } else if (zoom > 1) {
        panStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: panDraft.current.x, panY: panDraft.current.y };
      }
      return;
    }
    if (zoom > 1 && event.button === 0) panStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: panDraft.current.x, panY: panDraft.current.y };
  }
  function pointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "touch" && pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch.current && pointers.current.size >= 2) {
        const points = [...pointers.current.values()];
        changeZoom(pinch.current.zoom * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / pinch.current.distance);
        return;
      }
    }
    const start = panStart.current;
    if (start?.id === event.pointerId) {
      const next = { x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y };
      panDraft.current = next;
      setPan(next);
    }
  }
  function pointerUp(event: ReactPointerEvent<HTMLElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (panStart.current?.id === event.pointerId) panStart.current = null;
    if (event.pointerType === "touch" && !pointers.current.size) {
      const now = Date.now();
      if (now - lastTap.current < 280) changeZoom(zoom > 1 ? 1 : 2);
      lastTap.current = now;
    }
  }
  async function toggleFullscreen() {
    if (!document.fullscreenElement) await shellRef.current?.requestFullscreen(); else await document.exitFullscreen();
  }
  async function share() {
    const url = `${catalog.publicUrl}?page=${visiblePages[0] || 1}`;
    try {
      if (navigator.share) await navigator.share({ title: catalog.title, text: catalog.description, url });
      else { await navigator.clipboard.writeText(url); setNotice("Link copied"); window.setTimeout(() => setNotice(""), 1800); }
      if (!preview) dispatchAnalytics(`/api/catalogs/${catalog.id}/view`, { type: "share" });
    } catch { /* User cancelled sharing. */ }
  }
  function submitPage(event: FormEvent) { event.preventDefault(); goToPage(Number(pageInput) || 1, false); }

  if (loadError) {
    return <div className="rk-reader-loading"><Brand /><div className="rk-reader-load-copy"><p>{loadError}</p>{loadDiagnostic && process.env.NODE_ENV !== "production" && <small>{loadDiagnostic}</small>}<button type="button" onClick={() => setRetryKey((value) => value + 1)}><RefreshCw size={15} /> Try again</button></div></div>;
  }
  if (loading || !pdf || !total || !coverReady) {
    const stageLabel = pdfStage === "loading-document" ? "Loading PDF metadata…" : pdfStage === "loading-page" ? "Loading page 1…" : pdfStage === "rendering-page" ? "Rendering page 1…" : "Preparing reader…";
    return <div className="rk-reader-loading"><Brand />{pdf && <canvas ref={coverCanvasRef} className="rk-reader-cover-preview" aria-label={`${catalog.title}, page 1`} />}<div className="rk-reader-load-copy"><i /><p>{stageLabel}</p></div></div>;
  }

  const canPrevious = currentIndex > 0 && flipState === "read";
  const canNext = currentIndex < total - 1 && flipState === "read";
  return (
    <div className={`catalog-viewer rk-reader ${preview ? "preview-viewer" : ""} ${zoom > 1 ? "is-zoomed" : ""}`} ref={shellRef}>
      <header className="rk-reader-header">
        <div className="rk-reader-brand"><Brand /><span>{catalog.collection}{catalog.season ? ` · ${catalog.season}` : ""}</span></div>
        <div className="rk-reader-title"><span>{catalog.title}</span>{preview && <em>Staff preview</em>}</div>
        <div className="rk-reader-header-actions">
          {catalog.settings.showBackButton && <button className="rk-reader-icon" type="button" aria-label="Go back" onClick={() => history.back()}><ArrowLeft size={17} /></button>}
          <button className="rk-reader-icon" type="button" aria-label="Share catalog" onClick={share}><Share2 size={17} /></button>
          {catalog.settings.allowDownload && catalog.downloadUrl && !preview && <a className="rk-reader-icon" aria-label="Download PDF" href={catalog.downloadUrl}><Download size={17} /></a>}
          <button className="rk-reader-icon" type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>
          {preview && <a className="rk-reader-icon" aria-label="Close preview" href="/admin"><X size={18} /></a>}
        </div>
      </header>
      <main className="rk-reader-stage" ref={stageRef} onPointerDownCapture={pointerDown} onPointerMoveCapture={pointerMove} onPointerUpCapture={pointerUp} onPointerCancelCapture={pointerUp} onDoubleClick={() => changeZoom(zoom > 1 ? 1 : 2)}>
        <div className="rk-reader-meta"><span>{catalog.collection}{catalog.season ? ` · ${catalog.season}` : ""}</span><h1>{catalog.title}</h1>{catalog.description && <p>{catalog.description}</p>}</div>
        {!layoutReady && <div className="rk-reader-layout-loading">Preparing lookbook…</div>}
        <button className="rk-reader-edge rk-reader-edge-left" type="button" aria-label="Previous page" disabled={!canPrevious} onClick={() => requestFlip("prev")}><ChevronLeft size={25} /></button>
        <div className="rk-reader-transform" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}><div className="rk-book-host" ref={hostRef} /></div>
        <button className="rk-reader-edge rk-reader-edge-right" type="button" aria-label="Next page" disabled={!canNext} onClick={() => requestFlip("next")}><ChevronRight size={25} /></button>
        <div className="rk-reader-hint" aria-hidden="true">Drag the page edge to turn</div>
      </main>
      <footer className="rk-reader-controls">
        <div className="rk-reader-control-group"><button className="rk-reader-icon" type="button" aria-label="Open thumbnails" onClick={() => setDrawer((value) => !value)}><Grid3X3 size={17} /></button><button className="rk-reader-icon rk-fit-control" type="button" aria-label="Fit to screen" onClick={() => changeZoom(1)}><Expand size={16} /></button></div>
        <div className="rk-reader-pagination"><button className="rk-reader-icon" type="button" aria-label="Previous page" onClick={() => requestFlip("prev")} disabled={!canPrevious}><ChevronLeft size={20} /></button><form onSubmit={submitPage}><input aria-label="Go to page" inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, "").slice(0, 5))} /><span>{orientation === "landscape" && visiblePages.length > 1 ? `–${visiblePages[1]}` : ""} / {total}</span></form><button className="rk-reader-icon" type="button" aria-label="Next page" onClick={() => requestFlip("next")} disabled={!canNext}><ChevronRight size={20} /></button></div>
        <div className="rk-reader-control-group rk-reader-zoom-controls"><button className="rk-reader-icon" type="button" aria-label="Zoom out" onClick={() => changeZoom(zoom - .25)} disabled={zoom <= 1}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button className="rk-reader-icon" type="button" aria-label="Zoom in" onClick={() => changeZoom(zoom + .25)} disabled={zoom >= MAX_ZOOM}><Plus size={16} /></button></div>
      </footer>
      <aside className={`rk-thumbnail-drawer ${drawer ? "is-open" : ""}`} aria-hidden={!drawer}><div className="rk-thumbnail-heading"><div><span>Pages</span><h2>{catalog.title}</h2><p>{visiblePages.join("–")} / {total}</p></div><button className="rk-reader-icon" type="button" aria-label="Close thumbnails" onClick={() => setDrawer(false)}><X size={18} /></button></div>{drawer && <div className="rk-thumbnail-grid">{Array.from({ length: total }, (_, index) => { const page = index + 1; return <button type="button" className={visiblePages.includes(page) ? "is-active" : ""} key={page} onClick={() => goToPage(page, false)}><span><canvas ref={(node) => { if (node) { node.dataset.page = String(page); thumbRefs.current.set(page, node); } else thumbRefs.current.delete(page); }} /></span><em>{String(page).padStart(2, "0")}</em></button>; })}</div>}</aside>
      {drawer && <button className="rk-drawer-scrim" type="button" aria-label="Close thumbnails" onClick={() => setDrawer(false)} />}
      {notice && <div className="rk-reader-toast">{notice}</div>}
    </div>
  );
}
