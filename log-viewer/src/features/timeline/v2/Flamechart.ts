import { Application, Container, Graphics } from 'pixi.js';
import type { FlamechartRect, ViewportState } from './types.js';

const RECT_HEIGHT = 15;
const MIN_RECT_WIDTH_PX = 0.1; // Reduced from 0.5 to show more rectangles when zoomed in
const BORDER_WIDTH = 1;
const MIN_ZOOM_NS = 0.001 * 1_000_000;

export class Flamechart {
  private app: Application | null = null;
  private chartContainer: Container | null = null;
  private rectGraphics: Graphics | null = null;
  private borderGraphics: Graphics | null = null;
  private allRects: FlamechartRect[] = [];
  private totalDuration = 0;
  private maxDepth = 0;
  private rafId: number | null = null;
  private initialZoom = 1;
  private viewport: ViewportState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    width: 0,
    height: 0,
  };
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  public async init(
    container: HTMLElement,
    rects: FlamechartRect[],
    totalDuration: number,
  ): Promise<void> {
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.allRects = rects;
    this.totalDuration = totalDuration;
    this.maxDepth = rects.length ? Math.max(...rects.map((r) => r.y)) : 0;
    this.viewport = {
      zoom: width / totalDuration,
      panX: 0,
      panY: 0,
      width,
      height,
    };
    this.initialZoom = this.viewport.zoom;

    this.app = new Application();
    await this.app.init({
      width,
      height,
      backgroundColor: 0x252526,
      antialias: true,
      autoStart: false,
    });

    container.appendChild(this.app.canvas);

    this.chartContainer = new Container();
    this.chartContainer.scale.y = -1; // flip Y so zero depth at bottom visually
    this.app.stage.addChild(this.chartContainer);

    // Create reusable Graphics objects for maximum performance
    // Batching all rects by color = minimal draw calls (~7-8 total)
    this.rectGraphics = new Graphics();
    this.borderGraphics = new Graphics();
    this.chartContainer.addChild(this.rectGraphics);
    this.chartContainer.addChild(this.borderGraphics);

    this.updateContainerTransform();

    this.setupInteractions(container);
    this.scheduleRender();
  }

  private setupInteractions(container: HTMLElement): void {
    container.addEventListener('wheel', this.onWheel.bind(this), {
      passive: false,
    });
    container.addEventListener('pointerdown', this.onPointerDown.bind(this));
    container.addEventListener('pointermove', this.onPointerMove.bind(this));
    container.addEventListener('pointerup', this.onPointerUp.bind(this));
    container.addEventListener('pointerleave', this.onPointerUp.bind(this));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // Horizontal scrolling with adaptive speed
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const deltaX = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const deltaMagnitude = Math.abs(deltaX);

      // Adaptive pan speed: slow scroll = slow pan, fast scroll = fast pan
      const basePanSpeed = 0.8;
      const panMultiplier = Math.pow(Math.min(deltaMagnitude / 20, 1), 1.5);
      const maxPanMultiplier = 3.0; // Maximum speed cap
      const adaptivePanSpeed = basePanSpeed + panMultiplier * maxPanMultiplier;

      this.viewport.panX -= deltaX * adaptivePanSpeed;

      this.updateContainerTransform();
      this.scheduleRender();
      return;
    }

    // Vertical scrolling: Zoom with adaptive speed based on scroll velocity
    const deltaMagnitude = Math.abs(e.deltaY);

    // Adaptive zoom with better separation between slow and fast
    // Use power curve for more pronounced difference
    // Slow scrolls (1-10): Stay close to base (gentle, precise)
    // Fast scrolls (50+): Scale up significantly (quick zoom)
    const baseZoomFactor = 0.008; // Reduced base for slower slow-scrolls
    const speedRatio = Math.min(deltaMagnitude / 20, 1); // Normalize to 0-1
    const speedMultiplier = Math.pow(speedRatio, 1.5); // Power curve for smoother acceleration
    const maxSpeedMultiplier = 4.0; // Maximum speed cap (was unlimited at 5x)
    const zoomSpeed = baseZoomFactor * (1 + speedMultiplier * maxSpeedMultiplier);

    const zoomChange = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    const oldZoom = this.viewport.zoom;
    let newZoom = oldZoom * (1 + zoomChange);

    const maxZoom = this.viewport.width / MIN_ZOOM_NS;
    newZoom = Math.max(this.initialZoom, Math.min(newZoom, maxZoom));

    if (newZoom === oldZoom) {
      return;
    }

    // Zoom toward mouse cursor
    const worldXBeforeZoom = (mouseX - this.viewport.panX) / oldZoom;
    const worldXAfterZoom = (mouseX - this.viewport.panX) / newZoom;
    const panXAdjustment = (worldXAfterZoom - worldXBeforeZoom) * newZoom;

    this.viewport.zoom = newZoom;
    this.viewport.panX += panXAdjustment;

    this.updateContainerTransform();
    this.scheduleRender();
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDragging) {
      return;
    }

    const deltaX = e.clientX - this.lastPointerX;
    const deltaY = e.clientY - this.lastPointerY;

    this.viewport.panX += deltaX;
    this.viewport.panY += deltaY;

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.updateContainerTransform();
    this.scheduleRender();
  }

  private updateContainerTransform(): void {
    if (!this.chartContainer) {
      return;
    }
    // Constrain pan to keep content edges stuck to container edges
    this.viewport.panX = this.constrainPanX(this.viewport.panX);
    this.viewport.panY = this.constrainPanY(this.viewport.panY);

    this.chartContainer.scale.x = this.viewport.zoom;
    this.chartContainer.x = this.viewport.panX;
    this.chartContainer.y = this.viewport.height + this.viewport.panY; // anchor bottom + vertical pan
  }

  private constrainPanX(panX: number): number {
    const contentWidth = this.totalDuration * this.viewport.zoom;
    const minPanX = Math.min(0, this.viewport.width - contentWidth);
    const maxPanX = 0;
    return Math.max(minPanX, Math.min(panX, maxPanX));
  }

  private constrainPanY(panY: number): number {
    const contentHeight = (this.maxDepth + 1) * RECT_HEIGHT; // vertical not scaled
    const minPanY = Math.min(0, this.viewport.height - contentHeight);
    const maxPanY = 0;
    return Math.max(minPanY, Math.min(panY, maxPanY));
  }

  private onPointerUp(): void {
    this.isDragging = false;
  }

  private scheduleRender(): void {
    if (this.rafId !== null) {
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.render();
      this.rafId = null;
    });
  }

  // TODO: Vectors / sprites for even better performance
  private render(): void {
    if (!this.chartContainer || !this.app || !this.rectGraphics || !this.borderGraphics) {
      return;
    }

    // Clear previous frame
    this.rectGraphics.clear();
    this.borderGraphics.clear();

    const visibleRects = this.cullRects();

    // OPTIMIZATION: Batch all rectangles by color
    // This minimizes GPU state changes - one draw call per color
    const rectsByColor = new Map<number, FlamechartRect[]>();
    for (const rect of visibleRects) {
      let batch = rectsByColor.get(rect.fillColor);
      if (!batch) {
        batch = [];
        rectsByColor.set(rect.fillColor, batch);
      }
      batch.push(rect);
    }

    // Draw all rectangles of same color together
    // Result: ~7 draw calls for 7 colors (instead of 100k+ individual draws)
    for (const [color, rects] of rectsByColor) {
      for (const rect of rects) {
        const x = rect.x;
        const y = rect.y * RECT_HEIGHT;
        const w = rect.width;
        this.rectGraphics.rect(x, y, w - 1, RECT_HEIGHT - 1);
      }
      this.rectGraphics.fill({ color });
    }

    for (const rect of visibleRects) {
      const x = rect.x + 0.5;
      const y = (rect.y + 0.5) * RECT_HEIGHT;
      const w = rect.width - 0.5;

      // Skip borders if rectangle is too small (would be all border)
      const rectHeight = RECT_HEIGHT - 0.5;

      // Top border
      this.borderGraphics.rect(x, y, w, rectHeight);
    }
    this.app.renderer.render(this.app.stage);
  }

  private cullRects(): FlamechartRect[] {
    const minY = -this.viewport.panY;
    const maxY = minY + this.viewport.height;
    const minDepth = Math.floor(minY / RECT_HEIGHT);
    const maxDepth = Math.ceil(maxY / RECT_HEIGHT);

    // Compute visible world range derived from pan/zoom applied to container
    const minX = -this.viewport.panX / this.viewport.zoom;
    const maxX = (this.viewport.width - this.viewport.panX) / this.viewport.zoom;

    return this.allRects.filter((rect) => {
      const rectWidthPx = rect.width * this.viewport.zoom;
      if (rectWidthPx < MIN_RECT_WIDTH_PX) {
        return false;
      }

      const depth = rect.y;
      if (depth < minDepth - 1 || depth > maxDepth + 1) {
        return false;
      }

      const rectEndX = rect.x + rect.width;
      if (rectEndX < minX || rect.x > maxX) {
        return false;
      }

      return true;
    });
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rectGraphics?.destroy();
    this.borderGraphics?.destroy();
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.chartContainer = null;
    this.rectGraphics = null;
    this.borderGraphics = null;
  }
}
