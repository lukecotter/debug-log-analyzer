/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { LogSubCategory } from '../../../core/log-parser/types.js';
import { Flamechart } from './Flamechart.js';
import type { FlamechartRect } from './types.js';

/* eslint-disable @typescript-eslint/naming-convention */
const COLOR_MAP: Partial<Record<LogSubCategory, number>> = {
  'Code Unit': 0x88ae58,
  Workflow: 0x51a16e,
  Method: 0x2b8f81,
  Flow: 0x337986,
  DML: 0x285663,
  SOQL: 0x5d4963,
  'System Method': 0x5c3444,
};
/* eslint-enable @typescript-eslint/naming-convention */

function convertToFlamechartRects(rootNodes: LogEvent[]): FlamechartRect[] {
  const rects: FlamechartRect[] = [];
  let depth = 0;
  let currentLevel = rootNodes.filter((n) => n.duration);

  while (currentLevel.length) {
    const nextLevel: LogEvent[] = [];

    for (const node of currentLevel) {
      if (node.duration && node.subCategory) {
        const fillColor = COLOR_MAP[node.subCategory] ?? 0x808080;
        rects.push({
          x: node.timestamp,
          y: depth,
          width: node.duration.total,
          fillColor,
        });
      }

      for (const child of node.children) {
        if (child.duration) {
          nextLevel.push(child);
        }
      }
    }

    depth++;
    currentLevel = nextLevel;
  }

  return rects;
}

export class TimelineFlamechartAdapter {
  private flamechart: Flamechart | null = null;

  public async init(container: HTMLElement, apexLog: ApexLog): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[Adapter] Converting ApexLog:', {
      exitStamp: apexLog.exitStamp,
      childrenCount: apexLog.children.length,
    });

    const rects = convertToFlamechartRects(apexLog.children);
    const totalDuration = apexLog.exitStamp;

    // eslint-disable-next-line no-console
    console.log('[Adapter] Converted:', {
      rectCount: rects.length,
      totalDuration,
      sampleRects: rects.slice(0, 3),
    });

    this.flamechart = new Flamechart();
    await this.flamechart.init(container, rects, totalDuration);
  }

  public destroy(): void {
    this.flamechart?.destroy();
    this.flamechart = null;
  }
}
