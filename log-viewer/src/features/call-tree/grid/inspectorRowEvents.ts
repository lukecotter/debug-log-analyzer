/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { rowDetailSelection, rowFrames, type RowReader } from '../../../components/locatedRow.js';
import { eventBus, type DetailSource, type SelectionView } from '#core/events/EventBus.js';
import type { SelectionEchoGuard } from '#core/events/SelectionEchoGuard.js';
import type { LogStore } from '#core/log/LogStore.js';
import type { GridRowDetail, GridSelectDetail, LvGrid, RowKey } from '../../../grid/index.js';

/** What {@link inspectorRowEvents} reads a grid's rows and the inspector by. */
export interface InspectorRowEventsOptions<R> extends RowReader<R> {
  source: DetailSource;
  /** The store the grid's rows were built from. */
  store: () => LogStore | null;
  /** The direction the grid's rows read in. */
  view: () => SelectionView;
  echoGuard: SelectionEchoGuard;
  /** Drops the mark a picked inspector row left in the grid. */
  dropPick: () => void;
}

/** The row selected last, as a rebuild finds it again. */
export interface SelectedRow {
  eventId: number | undefined;
  /** The bucket keys that name a merged row, outermost first, which a rebuilt tree shares. */
  pathKeys: readonly string[] | undefined;
}

/** The `lv-grid-select` and `lv-grid-locate` handlers that tell the inspector what a call-tree row stands for. */
export function inspectorRowEvents<R>(opts: InspectorRowEventsOptions<R>): {
  select: (e: Event) => void;
  locate: (e: Event) => void;
  /** The row selected last, programmatic selects included. */
  selected: () => SelectedRow | undefined;
} {
  let selected: { eventId?: number; pathId?: number; store: LogStore | null } | undefined;
  return {
    selected: () =>
      selected && {
        eventId: selected.eventId,
        pathKeys:
          selected.pathId === undefined
            ? undefined
            : selected.store?.keyPathIds().keysOf(selected.pathId),
      },
    select: (e) => {
      const { row } = (e as CustomEvent<GridSelectDetail<R>>).detail;
      // A deselect the inspector does not hear about, as before a rebuild, keeps the row.
      if (row || !opts.echoGuard.suppressed) {
        const data = row ? opts.data(row) : undefined;
        selected = data && { eventId: data.eventId, pathId: data._pathId, store: opts.store() };
      }
      if (opts.echoGuard.suppressed) {
        return;
      }
      const view = opts.view();
      const selection = rowDetailSelection(row, opts, opts.store(), view);
      if (!selection) {
        // The selection went with it, and so does a mark a picked inspector row
        // left here — it was never a selection of this grid.
        opts.dropPick();
      }
      eventBus.emit('detail:select', { source: opts.source, selection, view });
    },
    locate: (e) => {
      const { row } = (e as CustomEvent<GridRowDetail<R>>).detail;
      eventBus.emit('detail:locate', {
        source: opts.source,
        eventIds: row ? rowFrames(row, opts, opts.store(), opts.view()) : [],
      });
    },
  };
}

/**
 * Builds `grid`'s rows again, then selects the row of the selected event, without telling
 * the inspector, which still has that event. A row key can be minted per build, so the old
 * selection is cleared first: its key could name another row.
 *
 * @param selected - read once the rows are built, so a pick made meanwhile wins
 * @param rebuild - resolves true when the rows it built are still the grid's
 * @param pathTo - the row keys down to the selected row, read after the rebuild
 */
export async function rebuildKeepingSelection(
  grid: Pick<LvGrid<object>, 'deselect' | 'goTo'>,
  echoGuard: SelectionEchoGuard,
  selected: () => SelectedRow | undefined,
  rebuild: () => Promise<boolean>,
  pathTo: (row: SelectedRow) => RowKey[],
): Promise<void> {
  echoGuard.run(() => grid.deselect());
  if (!(await rebuild())) {
    return;
  }
  const row = selected();
  if (!row) {
    return;
  }
  const path = pathTo(row);
  await echoGuard.runAsync(() => grid.goTo(path, { scrollIfVisible: false }));
}
