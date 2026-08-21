declare module "page-flip" {
  export type PageFlipOrientation = "portrait" | "landscape";
  export type PageFlipCorner = "top" | "bottom";

  export type PageFlipSettings = {
    startPage?: number;
    size?: "fixed" | "stretch";
    width: number;
    height: number;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    startZIndex?: number;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    swipeDistance?: number;
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
  };

  export type PageFlipEvent<T = unknown> = { data: T; object: PageFlip };

  export class PageFlip {
    constructor(element: HTMLElement, settings: PageFlipSettings);
    loadFromHTML(items: HTMLElement[] | NodeListOf<HTMLElement>): void;
    on<T = unknown>(event: string, callback: (event: PageFlipEvent<T>) => void): PageFlip;
    off(event: string): void;
    destroy(): void;
    update(): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getOrientation(): PageFlipOrientation;
    flipNext(corner?: PageFlipCorner): void;
    flipPrev(corner?: PageFlipCorner): void;
    flip(page: number, corner?: PageFlipCorner): void;
    turnToPage(page: number): void;
  }
}
