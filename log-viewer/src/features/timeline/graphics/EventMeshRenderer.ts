/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * EventMeshRenderer - SIMPLIFIED VERSION
 *
 * Scale all rectangles to fit on screen, use single color, no zoom/pan.
 * Just get mesh rendering working first.
 */

import * as PIXI from 'pixi.js';
import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import { TimelineEventIndex } from '../services/TimelineEventIndex.js';
import type { MeshRenderer, MeshRendererConfig } from '../types/mesh-renderer.types.js';
import type { ViewportState } from '../types/timeline.types.js';
import { TIMELINE_CONSTANTS } from '../types/timeline.types.js';

/**
 * Pre-computed event rectangle.
 */
interface PrecomputedRect {
  timeStart: number;
  timeEnd: number;
  depth: number;
  duration: number;
  category: string;
  color: number;
}

export class EventMeshRenderer implements MeshRenderer {
  private container: PIXI.Container;
  private categoryColors: Map<string, number>;
  private rects: PrecomputedRect[] = [];
  private mesh: PIXI.Mesh<PIXI.Geometry, PIXI.Shader> | null = null;
  private shader: PIXI.Shader | null = null;
  private viewport: ViewportState;
  private index: TimelineEventIndex;
  private vertexBuffer: PIXI.Buffer | null = null;
  private vertices: Float32Array | null = null;

  constructor(config: MeshRendererConfig) {
    this.container = config.container as PIXI.Container;
    this.categoryColors = new Map();
    this.viewport = config.viewport;
    this.index = config.index;

    for (const [category, batch] of config.batches) {
      this.categoryColors.set(category, batch.color);
    }

    // Precompute all rectangles
    this.precomputeRectangles(config.events);

    // Build single mesh with all rectangles
    this.buildSimpleMesh();
  }

  /**
   * Flatten event tree into rectangles.
   */
  private precomputeRectangles(events: LogEvent[]): void {
    const stack: { events: LogEvent[]; depth: number }[] = [{ events, depth: 0 }];

    while (stack.length > 0) {
      const { events: currentEvents, depth } = stack.pop()!;

      for (const event of currentEvents) {
        if (event.duration.total && event.subCategory) {
          const color = this.categoryColors.get(event.subCategory) ?? 0x808080;

          this.rects.push({
            timeStart: event.timestamp,
            timeEnd: event.exitStamp ?? event.timestamp,
            depth,
            duration: event.duration.total,
            category: event.subCategory,
            color,
          });
        }

        if (event.children?.length) {
          stack.push({ events: event.children, depth: depth + 1 });
        }
      }
    }
  }

  /**
   * Build mesh with dynamic vertex buffer for screen-space coordinates.
   * Positions are recalculated every frame on CPU in render() to avoid
   * float32 precision loss from mixing large timestamps with small zoom values.
   * This matches how PixiJS Graphics API (gfx.rect) works internally.
   */
  private buildSimpleMesh(): void {
    if (this.rects.length === 0) {
      return;
    }

    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    // Build vertex buffer (ALL rectangles)
    // Store: x, y (recalculated each frame), r, g, b (static)
    const verticesPerRect = 4;
    const floatsPerVertex = 5; // x, y, r, g, b
    const totalRects = this.rects.length;
    this.vertices = new Float32Array(totalRects * verticesPerRect * floatsPerVertex);

    // Build index buffer
    const indicesPerRect = 6;
    const indices = new Uint32Array(totalRects * indicesPerRect);

    let vertexOffset = 0;
    let indexOffset = 0;
    let vertexIndex = 0;

    // Populate color data (positions will be set in render())
    for (const rect of this.rects) {
      const y1 = rect.depth * eventHeight + halfGap;
      const height = Math.max(1, eventHeight - gap);
      const y2 = y1 + height;

      // Unpack category color (0xRRGGBB -> normalized RGB)
      const r = ((rect.color >> 16) & 0xff) / 255.0;
      const g = ((rect.color >> 8) & 0xff) / 255.0;
      const b = (rect.color & 0xff) / 255.0;

      // Vertex 0: top-left (x will be set in render)
      this.vertices[vertexOffset++] = 0; // x placeholder
      this.vertices[vertexOffset++] = y1;
      this.vertices[vertexOffset++] = r;
      this.vertices[vertexOffset++] = g;
      this.vertices[vertexOffset++] = b;

      // Vertex 1: top-right (x will be set in render)
      this.vertices[vertexOffset++] = 0; // x placeholder
      this.vertices[vertexOffset++] = y1;
      this.vertices[vertexOffset++] = r;
      this.vertices[vertexOffset++] = g;
      this.vertices[vertexOffset++] = b;

      // Vertex 2: bottom-right (x will be set in render)
      this.vertices[vertexOffset++] = 0; // x placeholder
      this.vertices[vertexOffset++] = y2;
      this.vertices[vertexOffset++] = r;
      this.vertices[vertexOffset++] = g;
      this.vertices[vertexOffset++] = b;

      // Vertex 3: bottom-left (x will be set in render)
      this.vertices[vertexOffset++] = 0; // x placeholder
      this.vertices[vertexOffset++] = y2;
      this.vertices[vertexOffset++] = r;
      this.vertices[vertexOffset++] = g;
      this.vertices[vertexOffset++] = b;

      // Triangles
      indices[indexOffset++] = vertexIndex + 0;
      indices[indexOffset++] = vertexIndex + 1;
      indices[indexOffset++] = vertexIndex + 2;
      indices[indexOffset++] = vertexIndex + 0;
      indices[indexOffset++] = vertexIndex + 2;
      indices[indexOffset++] = vertexIndex + 3;

      vertexIndex += 4;
    }

    // Create PixiJS geometry
    const geometry = new PIXI.Geometry();
    this.vertexBuffer = new PIXI.Buffer({
      data: this.vertices,
      usage: PIXI.BufferUsage.VERTEX | PIXI.BufferUsage.COPY_DST, // Dynamic: updated every frame
    });

    geometry.addAttribute('aPosition', {
      buffer: this.vertexBuffer,
      size: 2,
      stride: 20,
      offset: 0,
    });

    geometry.addAttribute('aColor', {
      buffer: this.vertexBuffer,
      size: 3,
      stride: 20,
      offset: 8,
    });

    geometry.addIndex(indices);

    // Custom shader applies zoom/pan to pre-normalized coordinates
    // Vertices are already normalized relative to baseTime on CPU
    const glProgram = new PIXI.GlProgram({
      vertex: `
        precision highp float;
        attribute vec2 aPosition;
        attribute vec3 aColor;

        uniform mat3 uProjectionMatrix;
        uniform float uViewportHeight;
        uniform float uOffsetY;

        varying vec3 vColor;

        void main() {
          // aPosition already contains screen-space pixel coordinates (calculated on CPU)
          // Apply offsetY for vertical pan, then viewport height transform for Y-axis inversion
          float x = aPosition.x;
          float y = uViewportHeight - (aPosition.y + uOffsetY);
          vec2 pos = vec2(x, y);

          // Apply projection matrix
          vec3 position = uProjectionMatrix * vec3(pos, 1.0);
          gl_Position = vec4(position.xy, 0.0, 1.0);

          vColor = aColor;
        }
      `,
      fragment: `
        precision highp float;
        varying vec3 vColor;

        void main() {
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
    });

    // Create uniform group for custom shader
    const uniformGroup = new PIXI.UniformGroup({
      uViewportHeight: { value: this.viewport.displayHeight, type: 'f32' },
      uOffsetY: { value: this.viewport.offsetY, type: 'f32' },
    });

    this.shader = new PIXI.Shader({
      glProgram,
      resources: {
        customUniforms: uniformGroup,
      },
    });

    // Create mesh
    this.mesh = new PIXI.Mesh({
      geometry,
      shader: this.shader,
    });

    this.container.addChild(this.mesh);
  }

  /**
   * Update vertex positions and shader uniforms each frame.
   * Recalculates screen-space pixel coordinates on CPU to avoid float32 precision
   * loss from mixing large timestamps with small zoom values. This matches how
   * PixiJS Graphics API (gfx.rect) works internally.
   */
  public render(viewport: ViewportState): void {
    if (!this.shader || !this.mesh || !this.vertices || !this.vertexBuffer) {
      return;
    }

    // Recalculate X positions on CPU in screen pixels (matching Graphics API behavior)
    // This avoids float32 precision issues from large timestamp × small zoom in shader
    const { zoom, offsetX } = viewport;
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    let vertexOffset = 0;
    const floatsPerVertex = 5;

    for (const rect of this.rects) {
      // Calculate screen-space X coordinates (pixels)
      // Same as EventBatchRenderer: x = timeStart * zoom
      // Then subtract offsetX to position relative to viewport
      const x1 = rect.timeStart * zoom - offsetX + halfGap;
      const screenWidth = rect.duration * zoom;
      const gappedWidth = Math.max(0, screenWidth - gap);
      const x2 = x1 + gappedWidth;

      // Update vertex 0 (top-left) X
      this.vertices[vertexOffset] = x1;
      vertexOffset += floatsPerVertex;

      // Update vertex 1 (top-right) X
      this.vertices[vertexOffset] = x2;
      vertexOffset += floatsPerVertex;

      // Update vertex 2 (bottom-right) X
      this.vertices[vertexOffset] = x2;
      vertexOffset += floatsPerVertex;

      // Update vertex 3 (bottom-left) X
      this.vertices[vertexOffset] = x1;
      vertexOffset += floatsPerVertex;
    }

    // Upload updated vertex data to GPU
    this.vertexBuffer.data = this.vertices;
    this.vertexBuffer.update();

    // Update shader uniforms
    const uniformGroup = this.shader.resources.customUniforms as PIXI.UniformGroup;
    uniformGroup.uniforms.uViewportHeight = viewport.displayHeight;
    uniformGroup.uniforms.uOffsetY = viewport.offsetY;
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
    if (this.mesh) {
      this.mesh.destroy();
      this.mesh = null;
    }
    this.rects = [];
  }
}
