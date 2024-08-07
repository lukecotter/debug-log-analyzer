/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeCheckbox } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, render, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  Tabulator,
  type ColumnComponent,
  type GroupComponent,
  type RowComponent,
} from 'tabulator-tables';

import * as CommonModules from '../../datagrid/module/CommonModules.js';

import { DatabaseAccess } from '../../Database.js';
import NumberAccessor from '../../datagrid/dataaccessor/Number.js';
import Number from '../../datagrid/format/Number.js';
import { RowKeyboardNavigation } from '../../datagrid/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../datagrid/module/RowNavigation.js';
import dataGridStyles from '../../datagrid/style/DataGrid.scss';
import { ApexLog, DMLBeginLine } from '../../parsers/ApexLogParser.js';
import { vscodeMessenger } from '../../services/VSCodeExtensionMessenger.js';
import { globalStyles } from '../../styles/global.styles.js';
import '../CallStack.js';
import { Find, formatter } from '../calltree-view/module/Find.js';
import './DatabaseSection.js';
import databaseViewStyles from './DatabaseView.scss';

provideVSCodeDesignSystem().register(vsCodeCheckbox());
let dmlTable: Tabulator;
let holder: HTMLElement | null = null;
let table: HTMLElement | null = null;
let findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
  text: '',
  count: 0,
  options: { matchCase: false },
};
let findMap: { [key: number]: RowComponent } = {};
let totalMatches = 0;

@customElement('dml-view')
export class DMLView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @property()
  highlightIndex: number = 0;

  @property()
  oldIndex: number = 0;

  @state()
  dmlLines: DMLBeginLine[] = [];

  get _dmlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-dml-table') ?? null;
  }

  constructor() {
    super();

    document.addEventListener('lv-find', this._find as EventListener);
    document.addEventListener('lv-find-close', this._find as EventListener);
  }

  updated(changedProperties: PropertyValues): void {
    if (this.timelineRoot && changedProperties.has('timelineRoot')) {
      this._appendTableWhenVisible();
    }
    if (changedProperties.has('highlightIndex')) {
      this._highlightMatches(this.highlightIndex);
    }
  }

  static styles = [
    unsafeCSS(dataGridStyles),
    unsafeCSS(databaseViewStyles),
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      #dml-table-container {
        height: 100%;
      }

      #db-dml-table {
        overflow: hidden;
        table-layout: fixed;
        width: 100%;
        margin-bottom: 1rem;
      }
    `,
  ];

  render() {
    const dmlSkeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : ``;

    return html`
      <database-section title="DML Statements" .dbLines="${this.dmlLines}"></database-section>
      <div>
        <strong>Group by</strong>
        <div>
          <vscode-checkbox @change="${this._dmlGroupBy}" checked>DML</vscode-checkbox>
        </div>
      </div>
      <div id="dml-table-container">
        ${dmlSkeleton}
        <div id="db-dml-table"></div>
      </div>
    `;
  }

  _dmlGroupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    dmlTable.setGroupBy(target.checked ? 'dml' : '');
  }

  _appendTableWhenVisible() {
    const dmlTableWrapper = this._dmlTableWrapper;
    const treeRoot = this.timelineRoot;
    if (dmlTableWrapper && treeRoot) {
      const dbObserver = new IntersectionObserver(async (entries, observer) => {
        const visible = entries[0]?.isIntersecting;
        if (visible) {
          observer.disconnect();

          const dbAccess = await DatabaseAccess.create(treeRoot);
          this.dmlLines = dbAccess.getDMLLines() || [];

          Tabulator.registerModule(Object.values(CommonModules));
          Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, Find]);
          renderDMLTable(dmlTableWrapper, this.dmlLines);
        }
      });
      dbObserver.observe(this);
    }
  }

  _highlightMatches(highlightIndex: number) {
    if (!dmlTable?.element?.clientHeight) {
      return;
    }

    findArgs.count = highlightIndex;
    const currentRow = findMap[highlightIndex];
    const rows = [currentRow, findMap[this.oldIndex]];
    rows.forEach((row) => {
      row?.reformat();
    });
    if (currentRow) {
      //@ts-expect-error This is a custom function added in by RowNavigation custom module
      dmlTable.goToRow(currentRow, { scrollIfVisible: false, focusRow: false });
    }
    this.oldIndex = highlightIndex;
  }

  _find = (e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) => {
    const isTableVisible = !!dmlTable?.element?.clientHeight;
    if (!isTableVisible && !totalMatches) {
      return;
    }

    const newFindArgs = JSON.parse(JSON.stringify(e.detail));
    if (!isTableVisible) {
      newFindArgs.text = '';
    }

    const newSearch =
      newFindArgs.text !== findArgs.text ||
      newFindArgs.options.matchCase !== findArgs.options?.matchCase;
    findArgs = newFindArgs;

    const clearHighlights =
      e.type === 'lv-find-close' || (!isTableVisible && newFindArgs.count === 0);
    if (clearHighlights) {
      newFindArgs.text = '';
    }
    if (newSearch || clearHighlights) {
      //@ts-expect-error This is a custom function added in by Find custom module
      const result = dmlTable.find(findArgs);
      totalMatches = result.totalMatches;
      findMap = result.matchIndexes;

      if (!clearHighlights) {
        document.dispatchEvent(
          new CustomEvent('db-find-results', {
            detail: { totalMatches: result.totalMatches, type: 'dml' },
          }),
        );
      }
    }
  };
}

function renderDMLTable(dmlTableContainer: HTMLElement, dmlLines: DMLBeginLine[]) {
  const dmlData: DMLRow[] = [];
  if (dmlLines) {
    for (const dml of dmlLines) {
      dmlData.push({
        dml: dml.text,
        rowCount: dml.rowCount.self,
        timeTaken: dml.duration.total,
        timestamp: dml.timestamp,
        _children: [{ timestamp: dml.timestamp, isDetail: true }],
      });
    }
  }
  const dmlText = sortByFrequency(dmlData || [], 'dml');

  dmlTable = new Tabulator(dmlTableContainer, {
    height: '100%',
    clipboard: true,
    downloadEncoder: downlodEncoder('dml.csv'),
    downloadRowRange: 'all',
    downloadConfig: {
      columnHeaders: true,
      columnGroups: true,
      rowGroups: true,
      columnCalcs: false,
      dataTree: true,
    },
    //@ts-expect-error types need update array is valid
    keybindings: { copyToClipboard: ['ctrl + 67', 'meta + 67'] },
    clipboardCopyRowRange: 'all',
    rowKeyboardNavigation: true,
    data: dmlData, //set initial table data
    layout: 'fitColumns',
    placeholder: 'No DML statements found',
    columnCalcs: 'both',
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupValues: [dmlText],
    groupHeader(value, count, data: DMLRow[], _group) {
      const hasDetail = data.some((d) => {
        return d.isDetail;
      });

      const newCount = hasDetail ? count - 1 : count;
      return `
      <div class="db-group-row">
        <div class="db-group-row__title" title="${value}">${value}</div><span>(${newCount} DML)</span>
      </div>
        `;
    },

    groupToggleElement: 'header',
    selectableRowsCheck: function (row: RowComponent) {
      return !row.getData().isDetail;
    },
    dataTree: true,
    dataTreeBranchElement: false,
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
      headerMenu: csvheaderMenu('dml.csv'),
      headerWordWrap: true,
    },
    initialSort: [{ column: 'rowCount', dir: 'desc' }],
    headerSortElement: function (column, dir) {
      switch (dir) {
        case 'asc':
          return "<div class='sort-by--top'></div>";
          break;
        case 'desc':
          return "<div class='sort-by--bottom'></div>";
          break;
        default:
          return "<div class='sort-by'><div class='sort-by--top'></div><div class='sort-by--bottom'></div></div>";
      }
    },
    columns: [
      {
        title: 'DML',
        field: 'dml',
        sorter: 'string',
        bottomCalc: () => {
          return 'Total';
        },
        cssClass: 'datagrid-textarea datagrid-code-text',
        variableHeight: true,
        formatter: (cell, _formatterParams, _onRendered) => {
          const data = cell.getData() as DMLRow;
          return `<call-stack
            timestamp="${data.timestamp}"
            startDepth="0"
            endDepth="1"
          ></call-stack>`;
        },
      },
      {
        title: 'Row Count',
        field: 'rowCount',
        sorter: 'number',
        width: 90,
        bottomCalc: 'sum',
        hozAlign: 'right',
        headerHozAlign: 'right',
      },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: Number,
        formatterParams: {
          thousand: false,
          precision: 3,
        },
        accessorDownload: NumberAccessor,
        bottomCalcFormatter: Number,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3 },
      },
    ],
    rowFormatter: function (row) {
      const data = row.getData();
      if (data.isDetail && data.timestamp) {
        const detailContainer = createDetailPanel(data.timestamp);
        row.getElement().replaceChildren(detailContainer);
        row.normalizeHeight();
      }

      requestAnimationFrame(() => {
        formatter(row, findArgs);
      });
    },
  });

  dmlTable.on('tableBuilt', () => {
    dmlTable.setGroupBy('dml');
  });

  dmlTable.on('groupClick', (e: UIEvent, group: GroupComponent) => {
    if (!group.isVisible()) {
      dmlTable.blockRedraw();
      dmlTable.getRows().forEach((row) => {
        !row.isTreeExpanded() && row.treeExpand();
      });
      dmlTable.restoreRedraw();
    }
  });

  dmlTable.on('rowClick', function (e, row) {
    const data = row.getData();
    if (!(data.timestamp && data.dml)) {
      return;
    }

    const origRowHeight = row.getElement().offsetHeight;
    row.treeToggle();
    row.getCell('dml').getElement().style.height = origRowHeight + 'px';
  });

  dmlTable.on('renderStarted', () => {
    const holder = _getTableHolder();
    holder.style.minHeight = holder.clientHeight + 'px';
    holder.style.overflowAnchor = 'none';
  });

  dmlTable.on('renderComplete', () => {
    const holder = _getTableHolder();
    const table = _getTable();
    holder.style.minHeight = Math.min(holder.clientHeight, table.clientHeight) + 'px';
  });
}

function _getTable() {
  table ??= dmlTable.element.querySelector('.tabulator-table')! as HTMLElement;
  return table;
}

function _getTableHolder() {
  holder ??= dmlTable.element.querySelector('.tabulator-tableholder')! as HTMLElement;
  return holder;
}

function createDetailPanel(timestamp: number) {
  const detailContainer = document.createElement('div');
  detailContainer.className = 'row__details-container';
  render(html`<call-stack timestamp=${timestamp}></call-stack>`, detailContainer);

  return detailContainer;
}

function sortByFrequency(dataArray: DMLRow[], field: keyof DMLRow) {
  const map = new Map<unknown, number>();
  dataArray.forEach((row) => {
    const val = row[field];
    map.set(val, (map.get(val) || 0) + 1);
  });
  const newMap = new Map([...map.entries()].sort((a, b) => b[1] - a[1]));

  return [...newMap.keys()];
}

function csvheaderMenu(csvFileName: string) {
  return [
    {
      label: 'Export to CSV',
      action: function (_e: PointerEvent, column: ColumnComponent) {
        column.getTable().download('csv', csvFileName, { bom: true, delimiter: ',' });
      },
    },
  ];
}

function downlodEncoder(defaultFileName: string) {
  return function (fileContents: string, mimeType: string) {
    const vscode = vscodeMessenger.getVsCodeAPI();
    if (vscode) {
      vscodeMessenger.send<VSCodeSaveFile>('saveFile', {
        fileContent: fileContents,
        options: {
          defaultFileName: defaultFileName,
        },
      });
      return false;
    }

    return new Blob([fileContents], { type: mimeType });
  };
}

type VSCodeSaveFile = {
  fileContent: string;
  options: {
    defaultFileName: string;
  };
};

interface DMLRow {
  dml?: string;
  rowCount?: number;
  timeTaken?: number;
  timestamp: number;
  isDetail?: boolean;
  _children?: DMLRow[];
}
