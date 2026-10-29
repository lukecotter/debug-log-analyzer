/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-toolbar-button.js';
import { consume } from '@lit/context';
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import { logContext } from '#core/log/logContext.js';
import type { LogStore } from '#core/log/LogStore.js';

import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import { LocatedRowIds } from '../../../components/locatedRow.js';
import { InspectorTabController } from '../../../components/InspectorTabController.js';
import { revealFirstOf } from '../../../components/inspectorTab.js';
import { SelectionEchoGuard } from '#core/events/SelectionEchoGuard.js';
import { SubscriptionController } from '#core/events/SubscriptionController.js';
import { isVisible, setChanged } from '#core/utility/Util.js';
import {
  ColumnSettingsController,
  heldColumnTarget,
} from '../../../components/ColumnSettingsController.js';
import { exportCsv } from '../../../components/grid/exportCsv.js';
import { FindController } from '../../find/FindController.js';
import { GridColumnMenuController } from '../../../components/GridColumnMenuController.js';
import {
  columnViewSelect,
  gridGroupControls,
  gridToolbarActions,
} from '../../../components/gridToolbar.js';
import {
  clearGridFilters,
  hiddenAfterGoTo,
  HiddenRowController,
  hiddenRowNoteStyles,
} from '../../../components/grid/hiddenRowNote.js';
import type { GridColumn, GroupBy, RowFilter, RowKey, TreeSource } from '../../../grid/index.js';
import type { FilterRange } from '../../../components/grid/MinMax.js';
import {
  BOTTOM_UP_MEASURES,
  measureFilters,
  RowFilterCache,
  type MeasureFilterInputs,
} from '../../call-tree/grid/rowFilters.js';
import { CALL_TREE_VIEWS } from '../../../components/grid/ColumnViews.js';
import '../../call-tree/grid/CallTreeGrid.js';
import type { CallTreeGrid } from '../../call-tree/grid/CallTreeGrid.js';
import {
  BOTTOM_UP_WITHOUT_DETAILS,
  BOTTOM_UP_GROUPS,
  BOTTOM_UP_SORT,
  CALL_TREE_COLUMN_SETTINGS,
  bottomUpColumns,
  bottomUpGroupBy,
  hiddenByDetails,
  mergedLines,
  openType,
} from '../../call-tree/grid/columns.js';
import { reportedUsageOf } from '../../call-tree/utils/reportedUsage.js';
import {
  inspectorRowEvents,
  rebuildKeepingSelection,
} from '../../call-tree/grid/inspectorRowEvents.js';
import { MergedTree } from '../../call-tree/grid/mergedRows.js';
import type { BottomUpRow } from '../../call-tree/utils/Aggregation.js';
import { wireCategoryColoring } from '../../call-tree/utils/CategoryColoring.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// Components
import '../../../components/datagrid-facet-filter.js';
import '../../../components/datagrid-filter-bar.js';
import '../../../components/datagrid-range-filter.js';
import '../../../components/OverflowList.js';
import '../../../components/GridSkeleton.js';

@customElement('analysis-view')
export class AnalysisView extends LitElement {
  static styles = [
    globalStyles,
    hiddenRowNoteStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        /* inset previously provided by the tab panel's padding */
        padding: var(--lana-space-md) var(--lana-space-xs);
        box-sizing: border-box;
      }

      .analysis-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }

      #analysis-table-container {
        height: 100%;
        width: 100%;
        min-height: 0;
        min-width: 0;
      }
    `,
  ];

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  @state()
  private _source: TreeSource<BottomUpRow> | null = null;
  @state()
  private _rowLines: ((row: BottomUpRow) => number) | null = null;
  @state()
  private _columns: GridColumn<BottomUpRow>[] = [];
  @state()
  private _groupBy: GroupBy<BottomUpRow> | null = null;
  @state({ hasChanged: setChanged })
  private _marked: ReadonlySet<RowKey> = new Set();
  @state()
  private _colorize = false;
  @state()
  private _showDetails = false;
  @state()
  private _measures: MeasureFilterInputs = {
    namespaces: [],
    total: { start: null, end: null },
    self: { start: null, end: null },
  };
  private readonly _filterCache = new RowFilterCache();
  private readonly _hiddenRows = new HiddenRowController(this, {
    grid: () => this.grid,
    onClear: async ({ eventId }) => {
      clearGridFilters(this.renderRoot);
      await this._revealEventId(eventId, new AbortController().signal);
    },
  });

  // State, so the expand button follows the grid once it mounts.
  @state()
  grid: CallTreeGrid<BottomUpRow> | null = null;
  private _tree: MergedTree<BottomUpRow> | null = null;
  /** The store `_tree` was built from: the log, or the log without its details. */
  private _treeStore: LogStore | null = null;
  private _built: Promise<void> | null = null;
  private _builds = new AbortController();
  // A failed build shows its own alert in the grid.
  private _reload: Promise<void> | null = null;

  // A render binds `_columns` to the grid again, so the column view writes there, not to the grid.
  private readonly _columnTarget = heldColumnTarget<BottomUpRow>(
    () => this._columns,
    (columns) => (this._columns = columns),
    () => this.grid,
  );
  private readonly _settings = new ColumnSettingsController(this, {
    ...CALL_TREE_COLUMN_SETTINGS,
    targets: () => [this._columnTarget],
  });
  private readonly _menus = new GridColumnMenuController({
    target: this._columnTarget,
    menu: () => this.renderRoot.querySelector<ContextMenu>('context-menu'),
    columns: this._settings,
  });

  /** Guards the programmatic select made on the inspector's behalf. */
  private _echoGuard = new SelectionEchoGuard();
  private _locateIds = new LocatedRowIds();
  // Its own memo: one shared with the mark would drop the picked frames on each reveal.
  private _revealIds = new LocatedRowIds();

  private readonly _finder = new FindController(this, {
    targets: () => (this.grid ? [this.grid] : []),
  });

  private readonly _subscriptions = new SubscriptionController(this, () => [
    wireCategoryColoring(this, (on) => (this._colorize = on)),
  ]);

  private readonly _inspector = new InspectorTabController(this, 'analysis', {
    // A row is a method bucket rather than one event, so a frame is translated
    // into the paths of the rows it heads.
    mark: (eventIds) => this._markLocated(eventIds),
    // An inspector finding names one event; the grid holds it in the bucket for
    // its method, so that bucket is what gets revealed.
    reveal: (eventId, signal) => this._revealEventId(eventId, signal),
    // The grid reports the clear itself, which is what reaches the inspector.
    clear: () => this.grid?.deselect(),
    // A row buckets calls, so a merged pick moves to the first of them.
    revealMerged: revealFirstOf((eventId, signal) => this._revealEventId(eventId, signal)),
  });

  /**
   * Mark the buckets that hold `eventIds`. The grid ranks methods and expands
   * to their callers, so one frame heads a row at every caller depth it sits in.
   */
  private _markLocated(eventIds: readonly number[]): void {
    const pathIds = this._locateIds.idsFor(this._treeStore, eventIds, 'callers');
    this._marked = this._tree?.marked(pathIds) ?? new Set();
  }

  /**
   * Select the bucket holding `eventId` and scroll it into view. Guarded, so the
   * inspector keeps the findings it was clicked in rather than being rebuilt around
   * the row it just asked for.
   */
  private async _revealEventId(eventId: number, signal: AbortSignal): Promise<void> {
    this._hiddenRows.invalidate();
    const store = this.logStore;
    // A new log's build starts in `updated`, and its rows reach the grid in the render after it.
    await this.updateComplete;
    // A failed build stays in `_built` until the next log, so it must not fail every reveal.
    await this._built?.catch(() => undefined);
    await this.updateComplete;
    if (signal.aborted || !store || store !== this.logStore) {
      return;
    }

    // With Details off only frames show, so the buckets for debug lines, thrown
    // exceptions and query plans are left out — exactly the events a finding
    // points at. Turn Details on rather than reveal nothing.
    if (!this._showDetails && hiddenByDetails(store, eventId, true)) {
      this._showDetails = true;
      // `updated` starts the rebuild, which selects the old row again; the reveal goes after it.
      await this.updateComplete;
      await this._reload;
    }

    if (signal.aborted || store !== this.logStore) {
      return;
    }
    const { grid, _tree: tree } = this;
    const pathIds = this._revealIds.idsFor(this._treeStore, [eventId], 'callers');
    const row = tree?.rowFor(pathIds);
    if (!grid || !tree || !row) {
      return;
    }

    // Taken after the Details change, which invalidates every go-to before it.
    const current = this._hiddenRows.begin();
    const path = tree.pathTo(pathIds);
    const result = await this._echoGuard.runAsync(() =>
      grid.goTo(path, { scrollIfVisible: false }),
    );
    if (!signal.aborted && current() && tree === this._tree) {
      this._hiddenRows.show(
        hiddenAfterGoTo({ eventId, path, result, selectedKey: grid.selectedKey }),
      );
    }
  }

  willUpdate(changedProperties: PropertyValues): void {
    // A filter change can show the row, or hide another.
    if (changedProperties.has('_measures') || changedProperties.has('_showDetails')) {
      this._hiddenRows.invalidate();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // The inspector stops reporting on detach, so the empty mark of a pointer leaving may never come.
    this._marked = new Set();
  }

  updated(changedProperties: PropertyValues): void {
    if (
      changedProperties.has('_showDetails') &&
      !changedProperties.has('logStore') &&
      this._built
    ) {
      this._reload = this._reloadForDetails().catch(() => undefined);
    }
    if (!this.logStore || !changedProperties.has('logStore')) {
      return;
    }
    if (!changedProperties.get('logStore')) {
      this._buildWhenVisible();
    } else if (this._built) {
      // The grid keeps its sort, widths, group and filters. Its selection and mark named rows of the old log.
      this._marked = new Set();
      this._hiddenRows.invalidate();
      this.grid?.deselect();
      void this._rebuild();
    }
  }

  /** Builds the tree again, as a new log does, when Details changed, keeping the selection. */
  private async _reloadForDetails(): Promise<void> {
    this._marked = new Set();
    const grid = this.grid;
    if (!grid) {
      void this._rebuild();
      return;
    }
    await rebuildKeepingSelection(
      grid,
      this._echoGuard,
      this._rowEvents.selected,
      async () => {
        const built = this._rebuild();
        await built;
        // The new rows reach the grid in the render after the build.
        await this.updateComplete;
        return built === this._built && grid === this.grid;
      },
      ({ eventId, pathKeys }) => {
        const tree = this._tree;
        const store = this._treeStore;
        if (!tree || !store) {
          return [];
        }
        const path = pathKeys ? tree.pathToKeys(store, pathKeys) : [];
        return path.length || eventId === undefined
          ? path
          : tree.pathTo(this._revealIds.idsFor(store, [eventId], 'callers'));
      },
    );
  }

  private _rebuild(): Promise<void> | null {
    const store = this._storeShown();
    if (!store) {
      return null;
    }
    this._builds.abort();
    this._builds = new AbortController();
    return (this._built = this._build(store));
  }

  /** The store the tree builds, marks and locates from. */
  private _storeShown(): LogStore | null {
    const store = this.logStore;
    return store && !this._showDetails ? store.withoutDetails() : store;
  }

  render() {
    return html`
      <div class="analysis-view">
        ${this._hiddenRows.renderStatus()}
        <datagrid-filter-bar>
          ${columnViewSelect({
            id: 'column-view',
            views: CALL_TREE_VIEWS,
            columns: this._settings,
          })}

          <overflow-list slot="filters" menu-heading="Filters" icon="filter">
            <datagrid-facet-filter
              label="Namespace"
              .values="${this.logStore?.log.namespaces ?? []}"
              @datagrid-facet-change="${(e: CustomEvent<{ selected: string[] }>) =>
                (this._measures = { ...this._measures, namespaces: e.detail.selected })}"
            ></datagrid-facet-filter>
            <datagrid-range-filter
              label="Total Time"
              unit="ms"
              @datagrid-range-change="${(e: CustomEvent<{ range: FilterRange }>) =>
                (this._measures = { ...this._measures, total: e.detail.range })}"
            ></datagrid-range-filter>
            <datagrid-range-filter
              label="Self Time"
              unit="ms"
              @datagrid-range-change="${(e: CustomEvent<{ range: FilterRange }>) =>
                (this._measures = { ...this._measures, self: e.detail.range })}"
            ></datagrid-range-filter>
            <button
              type="button"
              class="filter-control pill-toggle"
              aria-pressed="${this._showDetails}"
              title="Show Detail Events"
              @click="${() => (this._showDetails = !this._showDetails)}"
            >
              Details
            </button>
          </overflow-list>

          ${gridGroupControls({
            grid: this.grid,
            group: {
              id: 'groupby-dropdown',
              labels: BOTTOM_UP_GROUPS.map(({ label }) => label),
              onChange: (label) => (this._groupBy = bottomUpGroupBy(label)),
            },
          })}
          ${gridToolbarActions({
            openColumns: this._menus.open,
            exportToCSV: () => void (this.grid && exportCsv(this.grid, 'analysis.csv')),
            copyToClipboard: () => void this.grid?.copy(),
          })}
        </datagrid-filter-bar>

        <div id="analysis-table-container">
          ${this._hiddenRows.renderNote()}
          ${this._source ? this._renderGrid() : html`<grid-skeleton></grid-skeleton>`}
        </div>
        <context-menu
          @menu-select="${(e: CustomEvent<{ itemId: string }>) => this._menus.select(e.detail.itemId)}"
        ></context-menu>
      </div>
    `;
  }

  private _renderGrid() {
    return html`
      <lv-call-tree-grid
        ${ref(this._gridMounted)}
        ?category-colorize="${this._colorize}"
        .label="${'Analysis'}"
        .placeholder="${'No Analysis Available'}"
        .source="${this._source}"
        .columns="${this._columns}"
        .filters="${this._filters()}"
        .sort="${BOTTOM_UP_SORT}"
        .rowLines="${this._rowLines}"
        .groupBy="${this._groupBy}"
        .marked="${this._marked}"
        @lv-grid-select="${this._rowEvents.select}"
        @lv-grid-locate="${this._rowEvents.locate}"
        @lv-grid-reshape="${() => void this._finder.rerun()}"
        @lv-grid-header-context="${this._menus.headerContext}"
      ></lv-call-tree-grid>
    `;
  }

  private _filters(): RowFilter<BottomUpRow>[] {
    const filters = measureFilters(
      this._measures,
      BOTTOM_UP_MEASURES,
      this._filterCache,
      'analysis',
    );
    return this._showDetails ? filters : [...filters, BOTTOM_UP_WITHOUT_DETAILS];
  }

  private readonly _gridMounted = (el?: Element): void => {
    this.grid = (el as CallTreeGrid<BottomUpRow> | undefined) ?? null;
  };

  private _buildWhenVisible(): void {
    void isVisible(this).then((visible) => {
      const store = this._storeShown();
      if (store && visible) {
        this._built ??= this._build(store);
      }
    });
  }

  private async _build(store: LogStore): Promise<void> {
    const { signal } = this._builds;
    const tree = await MergedTree.bottomUp(store, { signal });
    const reported = await reportedUsageOf(store.log);
    // A newer log, or a Details change, can start another build while the usage resolves.
    if (!tree || signal.aborted) {
      return;
    }
    this._tree = tree;
    this._treeStore = store;
    this._columns = bottomUpColumns(store.log, { openType, reported });
    this._rowLines = mergedLines(store.log);
    this._settings.applyTo(this._columnTarget);
    this._source = tree.source;
  }

  // A row ranks a method by self time and opens to its callers, so the inspector reads it as callers.
  private readonly _rowEvents = inspectorRowEvents<BottomUpRow>({
    source: 'analysis',
    store: () => this._treeStore,
    view: () => 'callers',
    data: (row) => row,
    parentOf: (row) => this._tree?.parentOf(row),
    echoGuard: this._echoGuard,
    dropPick: () => this._inspector.dropPick(),
  });
}
