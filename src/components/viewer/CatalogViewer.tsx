"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Expand, Grid3X3, Maximize, Minimize, Minus, Plus, RefreshCw, Share2, X } from "lucide-react";
import type { PageFlip as PageFlipInstance, PageFlipOrientation } from "page-flip";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PublicCatalogDto } from "@/types/catalog";
import { Brand } from "@/components/Brand";

const MAX_ZOOM = 3;
const MAX_CACHE = 18;
const PDF_ERROR = "Unable to load the source PDF.";

type BitmapRecord = { bitmap: ImageBitmap; lastUsed: number; key: string };

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
  const [pageCount, setPageCount] = useState(catalog.pageCount || 0);
  const [loadError, setLoadError] = useState("");
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
  const flipRef = useRef<PageFlipInstance | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const mediaRefs = useRef<(HTMLDivElement | null)[]>([]);
  const thumbRefs = useRef(new Map<number, HTMLCanvasElement>());
  const bitmapCache = useRef(new Map<string, BitmapRecord>());
  const pagePromises = useRef(new Map<number, Promise<PDFPageProxy>>());
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
    for (const record of bitmapCache.current.values()) record.bitmap.close();
    bitmapCache.current.clear();
  }, []);

  const getPage = useCallback(async (pageNumber: number) => {
    if (!pdf) throw new Error("PDF is not ready.");
    const existing = pagePromises.current.get(pageNumber);
    if (existing) return existing;
    const promise = pdf.getPage(pageNumber);
    pagePromises.current.set(pageNumber, promise);
    return promise;
  }, [pdf]);

  const evictCache = useCallback(() => {
    while (bitmapCache.current.size > MAX_CACHE) {
      const oldest = [...bitmapCache.current.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!oldest) break;
      oldest.bitmap.close();
      bitmapCache.current.delete(oldest.key);
    }
  }, []);

  const renderBitmap = useCallback(async (pageNumber: number, quality: "page" | "thumb") => {
    const key = `${pageNumber}:${quality}:${quality === "thumb" ? "0.32" : Math.min(2.25, 1.35 * zoomRef.current).toFixed(2)}`;
    const cached = bitmapCache.current.get(key);
    if (cached) { cached.lastUsed = Date.now(); return cached.bitmap; }
    const page = await getPage(pageNumber);
    const scale = quality === "thumb" ? 0.32 : Math.min(2.25, 1.35 * zoomRef.current);
    const viewport = page.getViewport({ scale });
    const outputScale = quality === "thumb" ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas rendering is unavailable.");
    await page.render({ canvas, canvasContext: context, viewport, transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined }).promise;
    const bitmap = await createImageBitmap(canvas);
    const record = { bitmap, lastUsed: Date.now(), key };
    bitmapCache.current.set(key, record);
    evictCache();
    return bitmap;
  }, [evictCache, getPage]);

  const paintCanvas = useCallback(async (pageNumber: number, canvas: HTMLCanvasElement, quality: "page" | "thumb") => {
    try {
      const bitmap = await renderBitmap(pageNumber, quality);
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      canvas.closest(".rk-page-media")?.classList.add("is-loaded");
    } catch { /* Page-level failures are retried with the next navigation. */ }
  }, [renderBitmap]);

  const hydrateWindow = useCallback((center: number) => {
    if (!pdf || !total) return;
    const start = Math.max(1, center + 1 - 4);
    const end = Math.min(total, center + 1 + 4);
    for (let page = start; page <= end; page += 1) {
      const canvas = canvasRefs.current[page - 1];
      if (canvas) void paintCanvas(page, canvas, "page");
      // Keep the adjacent pages warm without blocking the visible spread.
      if (Math.abs(page - (center + 1)) > 1) void renderBitmap(page, "page");
    }
  }, [pdf, paintCanvas, renderBitmap, total]);

  useEffect(() => { hydrateRef.current = hydrateWindow; }, [hydrateWindow]);

  useEffect(() => {
    let cancelled = false;
    const promises = pagePromises.current;
    // The loading state belongs to the asynchronous PDF task, not to server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setLoadError("");
    clearCache();
    promises.clear();
    void (async () => {
      try {
        const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
        GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const task = getDocument({ url: `/api/catalogs/${catalog.id}/pdf`, rangeChunkSize: 65536, disableAutoFetch: false, disableStream: false, withCredentials: false });
        const document = await task.promise;
        if (cancelled) return;
        setPdf(document);
        setPageCount(document.numPages);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setLoading(false);
        setLoadError(PDF_ERROR);
      }
    })();
    return () => { cancelled = true; clearCache(); promises.clear(); };
  }, [catalog.id, clearCache, retryKey]);

  useEffect(() => {
    if (!pdf || !hostRef.current || !total) return;
    let cancelled = false;
    let instance: PageFlipInstance | null = null;
    const host = hostRef.current;
    const mount = document.createElement("div");
    mount.className = "rk-book-engine";
    host.replaceChildren(mount);
    canvasRefs.current = [];
    mediaRefs.current = [];
    const elements = Array.from({ length: total }, (_, index) => {
      const pageNumber = index + 1;
      const element = document.createElement("section");
      element.className = "rk-flip-page";
      element.dataset.page = String(pageNumber);
      if (index === 0 || index === total - 1) element.dataset.density = "hard";
      const media = document.createElement("div");
      media.className = "rk-page-media";
      media.style.setProperty("--page-ratio", `${catalog.width || 0.707} / ${catalog.height || 1}`);
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
          const ratio = catalog.width && catalog.height ? catalog.height / catalog.width : 1.414;
          instance = new PageFlip(mount, {
            width: 1000,
            height: Math.round(1000 * ratio),
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
            hydrateRef.current(initial);
          });
          flipRef.current = instance;
          instance.loadFromHTML(elements);
        } catch { if (!cancelled) setLoadError("The catalog reader could not be initialized."); }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      flipRef.current = null;
      instance?.destroy();
      host.replaceChildren();
    };
  }, [catalog.height, catalog.title, catalog.width, pdf, total]);

  useEffect(() => {
    if (!total || !stageRef.current || !hostRef.current) return;
    const stage = stageRef.current;
    const host = hostRef.current;
    const measure = () => {
      const availableWidth = Math.max(1, stage.clientWidth - 110);
      const availableHeight = Math.max(1, stage.clientHeight - 34);
      const ratio = catalog.width && catalog.height ? catalog.width / catalog.height : 0.707;
      const portrait = window.innerWidth <= 640 || availableWidth < 640;
      const bookRatio = portrait ? ratio : ratio * 2;
      const width = Math.max(1, Math.min(availableWidth, availableHeight * bookRatio));
      host.style.width = `${width}px`;
      host.style.height = `${width / bookRatio}px`;
      host.style.aspectRatio = String(bookRatio);
      flipRef.current?.update();
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(stage);
    window.addEventListener("resize", measure, { passive: true });
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [catalog.height, catalog.width, total]);

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
    return <div className="rk-reader-loading"><Brand /><div className="rk-reader-load-copy"><p>{loadError}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)}><RefreshCw size={15} /> Try again</button></div></div>;
  }
  if (loading || !pdf || !total) {
    return <div className="rk-reader-loading"><Brand /><div className="rk-reader-load-copy"><i /><p>{loading ? "Loading PDF metadata…" : "Preparing reader…"}</p></div></div>;
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
