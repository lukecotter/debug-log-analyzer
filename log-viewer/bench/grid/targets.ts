/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { rowKinds } from '../../src/core/log/eventKind.js';
import { type LogIndex, NO_ROW } from '../../src/core/log/LogIndex.js';
import type { TimeOrderNode } from '../../src/features/call-tree/utils/TimeOrderTree.js';
import type { RowFilter } from '../../src/grid/index.js';

/** The deepest row in the middle of the log: the worst go-to-row a user can ask for. */
export function deepRow(index: LogIndex): number {
  const from = Math.floor(index.rowCount * 0.45);
  const to = Math.floor(index.rowCount * 0.55);
  let deepest = from;
  for (let row = from; row < to; row++) {
    if (index.depth[row]! > index.depth[deepest]!) {
      deepest = row;
    }
  }
  return deepest;
}

/** The event ids from the root down to `row`, as Time Order rows are keyed. */
export function pathOf(index: LogIndex, row: number): number[] {
  const path: number[] = [];
  for (let at = row; at !== NO_ROW; at = index.parent[at]!) {
    path.push(index.eventId[at]!);
  }
  return path.reverse();
}

/**
 * The filter Time Order used for Details off before it built without the details, kept so a
 * bench can time a filter over every row and compare across revisions.
 */
export function detailFilter(index: LogIndex): RowFilter<TimeOrderNode> {
  const kindOf = rowKinds(index);
  return { test: ({ row }) => kindOf(row) !== 'detail' };
}
