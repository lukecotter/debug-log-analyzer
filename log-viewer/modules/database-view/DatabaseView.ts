/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeCheckbox } from '@vscode/webview-ui-toolkit';
import { LitElement, type PropertyValues, css, html, render, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  type ColumnComponent,
  type GroupComponent,
  type RowComponent,
  TabulatorFull as Tabulator,
} from 'tabulator-tables';

import { DatabaseAccess } from '../Database.js';
import '../components/CallStack.js';
import NumberAccessor from '../datagrid/dataaccessor/Number.js';
import Number from '../datagrid/format/Number.js';
import { RowKeyboardNavigation } from '../datagrid/module/RowKeyboardNavigation.js';
import dataGridStyles from '../datagrid/style/DataGrid.scss';
import { globalStyles } from '../global.styles.js';
import {
  DMLBeginLine,
  RootNode,
  SOQLExecuteBeginLine,
  SOQLExecuteExplainLine,
} from '../parsers/TreeParser';
import { hostService } from '../services/VSCodeService';
import './DatabaseSOQLDetailPanel';
import './DatabaseSection';
import databaseViewStyles from './DatabaseView.scss';

provideVSCodeDesignSystem().register(vsCodeCheckbox());

let soqlTable: Tabulator;
let dmlTable: Tabulator;

@customElement('database-view')
export class DatabaseView extends LitElement {
  @property()
  timelineRoot: RootNode | null = null;

  @state()
  dmlLines: DMLBeginLine[] = [];

  @state()
  soqlLines: SOQLExecuteBeginLine[] = [];

  get _dmlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-dml-table') ?? null;
  }

  get _soqlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-soql-table') ?? null;
  }

  constructor() {
    super();
  }

  updated(changedProperties: PropertyValues): void {
    if (this.timelineRoot && changedProperties.has('timelineRoot')) {
      this._appendTableWhenVisible();
    }
  }

  static styles = [
    unsafeCSS(dataGridStyles),
    unsafeCSS(databaseViewStyles),
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      #db-container {
        overflow-y: scroll;
        overflow-x: hidden;
        height: 100%;
        width: 100%;
      }
      #dml-table-container,
      #soql-table-container {
        height: 100%;
        width: 100%;
      }
      #db-dml-table,
      #db-soql-table {
        overflow: hidden;
        table-layout: fixed;
        height: 100%;
        width: 100%;
        min-height: 0%;
        min-width: 0%;
      }
    `,
  ];

  render() {
    const dmlSkeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : ``;
    const soqlSkeleton = dmlSkeleton;

    return html`
      <div id="db-container">
        <div>
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
        </div>
        <div>
          <database-section title="SOQL Statements" .dbLines="${this.soqlLines}"></database-section>
          <div>
            <strong>Group by</strong>
            <div>
              <vscode-checkbox @change="${this._soqlGroupBy}" checked>SOQL</vscode-checkbox>
            </div>
          </div>
          <div id="soql-table-container">
            ${soqlSkeleton}
            <div id="db-soql-table"></div>
          </div>
        </div>
      </div>
    `;
  }

  _dmlGroupBy(event: any) {
    dmlTable.setGroupBy(event.target.checked ? 'dml' : '');
  }

  _soqlGroupBy(event: any) {
    soqlTable.setGroupBy(event.target.checked ? 'soql' : '');
  }

  _appendTableWhenVisible() {
    const dbContainer = this.renderRoot?.querySelector('#db-container');
    const dmlTableWrapper = this._dmlTableWrapper;
    const soqlTableWrapper = this._soqlTableWrapper;
    const treeRoot = this.timelineRoot;
    if (dbContainer && dmlTableWrapper && soqlTableWrapper && treeRoot) {
      const dbObserver = new IntersectionObserver(async (entries, observer) => {
        const visible = entries[0]?.isIntersecting;
        if (visible) {
          observer.disconnect();

          const dbAccess = await DatabaseAccess.create(treeRoot);
          this.dmlLines = dbAccess.getDMLLines() || [];
          this.soqlLines = dbAccess.getSOQLLines() || [];

          Tabulator.registerModule([RowKeyboardNavigation]);
          renderDMLTable(dmlTableWrapper, this.dmlLines);
          renderSOQLTable(soqlTableWrapper, this.soqlLines);
        }
      });
      dbObserver.observe(dbContainer);
    }
  }
}

function renderDMLTable(dmlTableContainer: HTMLElement, dmlLines: DMLBeginLine[]) {
  const dmlData: unknown[] = [];
  let dmlText: string[] = [];
  if (dmlLines) {
    for (const dml of dmlLines) {
      dmlText.push(dml.text);
      dmlData.push({
        dml: dml.text,
        rowCount: dml.selfRowCount,
        timeTaken: dml.duration,
        timestamp: dml.timestamp,
        _children: [{ timestamp: dml.timestamp, isDetail: true }],
      });
    }

    dmlText = sortByFrequency(dmlText);
  }

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
    groupHeader(value, count, data: any[], _group) {
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
    selectableCheck: function (row) {
      return !row.getData().isDetail;
    },
    dataTree: true,
    dataTreeBranchElement: '<span></span>',
    dataTreeCollapseElement: '<span></span>',
    dataTreeExpandElement: '<span></span>',
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
          const data: any = cell.getData();
          return `<call-stack
          timestamp=${data.timestamp}
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
      }
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

  dmlTable.on('groupVisibilityChanged', (group: GroupComponent, visible: boolean) => {
    const firstRow = visible ? group.getRows()[0] : group.getRows()[0]?.getPrevRow();
    if (firstRow) {
      // @ts-expect-error it has 2 params
      firstRow.scrollTo('center', true).then(() => {
        firstRow
          .getElement()
          .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      });
    }
  });

  dmlTable.on('rowClick', function (e, row) {
    const data = row.getData();
    if (!(data.timestamp && data.dml)) {
      return;
    }
    const origRowHeight = row.getElement().offsetHeight;

    row.treeToggle();
    row.getCell('soql').getElement().style.height = origRowHeight + 'px';

    const nextRow = row.getNextRow() || row.getTreeChildren()[0];
    if (nextRow) {
      // @ts-expect-error it has 2 params
      nextRow.scrollTo('center', true).then(() => {
        nextRow.getElement().scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      });
    }
  });
}

function renderSOQLTable(soqlTableContainer: HTMLElement, soqlLines: SOQLExecuteBeginLine[]) {
  const timestampToSOQl = new Map<number, SOQLExecuteBeginLine>();
  interface GridSOQLData {
    isSelective: boolean | null;
    relativeCost: number | null;
    soql: string;
    rowCount: number | null;
    timeTaken: number | null;
    aggregations: number;
    timestamp: number;
  }

  soqlLines?.forEach((line) => {
    timestampToSOQl.set(line.timestamp, line);
  });

  const soqlData: unknown[] = [];
  let soqlText: string[] = [];
  if (soqlLines) {
    for (const soql of soqlLines) {
      soqlText.push(soql.text);

      const explainLine = soql.children[0] as SOQLExecuteExplainLine;
      soqlData.push({
        isSelective: explainLine?.relativeCost ? explainLine.relativeCost <= 1 : null,
        relativeCost: explainLine?.relativeCost,
        soql: soql.text,
        rowCount: soql.selfRowCount,
        timeTaken: soql.duration,
        aggregations: soql.aggregations,
        timestamp: soql.timestamp,
        _children: [{ timestamp: soql.timestamp, isDetail: true }],
      });
    }

    soqlText = sortByFrequency(soqlText);
  }

  soqlTable = new Tabulator(soqlTableContainer, {
    height: '100%',
    rowKeyboardNavigation: true,
    data: soqlData,
    layout: 'fitColumns',
    placeholder: 'No SOQL queries found',
    columnCalcs: 'both',
    clipboard: true,
    downloadEncoder: downlodEncoder('soql.csv'),
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
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupValues: [soqlText],
    groupHeader(value, count, data: any[], _group) {
      const hasDetail = data.some((d) => {
        return d.isDetail;
      });

      const newCount = hasDetail ? count - 1 : count;
      return `
      <div class="db-group-row">
        <div class="db-group-row__title" title="${value}">${value}</div><span>(${newCount} ${
        newCount > 1 ? 'Queries' : 'Query'
      })</span>
      </div>`;
    },
    groupToggleElement: 'header',

    selectableCheck: function (row) {
      return !row.getData().isDetail;
    },
    dataTree: true,
    dataTreeBranchElement: '<span></span>',
    dataTreeCollapseElement: '<span></span>',
    dataTreeExpandElement: '<span></span>',
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
      headerMenu: csvheaderMenu('soql.csv'),
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
        title: 'SOQL',
        field: 'soql',
        headerSortStartingDir: 'asc',
        sorter: 'string',
        tooltip: true,
        bottomCalc: () => {
          return 'Total';
        },
        cssClass: 'datagrid-textarea datagrid-code-text',
        variableHeight: true,
        formatter: (cell, _formatterParams, _onRendered) => {
          cell.getRow().normalizeHeight();

          const data: any = cell.getData();
          return `<call-stack
          timestamp=${data.timestamp}
          startDepth="0"
          endDepth="1"
        ></call-stack>`;
        },
      },
      {
        title: 'Selective',
        field: 'isSelective',
        formatter: 'tickCross',
        formatterParams: {
          allowEmpty: true,
        },
        width: 40,
        hozAlign: 'center',
        vertAlign: 'middle',
        sorter: function (a, b, aRow, bRow, _column, dir, _sorterParams) {
          // Always Sort null values to the bottom (when we do not have selectivity)
          if (a === null) {
            return dir === 'asc' ? 1 : -1;
          } else if (b === null) {
            return dir === 'asc' ? -1 : 1;
          }

          const aRowData = aRow.getData();
          const bRowData = bRow.getData();

          return (aRowData.relativeCost || 0) - (bRowData.relativeCost || 0);
        },
        tooltip: function (e, cell, _onRendered) {
          const { isSelective, relativeCost } = cell.getData() as GridSOQLData;
          let title;
          if (isSelective === null) {
            title = 'Selectivity could not be determined.';
          } else if (isSelective) {
            title = 'Query is selective.';
          } else {
            title = 'Query is not selective.';
          }

          if (relativeCost) {
            title += `<br>Relative cost: ${relativeCost}`;
          }
          return title;
        },
        accessorDownload: function (
          _value: any,
          data: any,
          _type: 'data' | 'download' | 'clipboard',
          _accessorParams: any,
          _column?: ColumnComponent,
          _row?: RowComponent
        ): any {
          return data.relativeCost;
        },
        accessorClipboard: function (
          _value: any,
          data: any,
          _type: 'data' | 'download' | 'clipboard',
          _accessorParams: any,
          _column?: ColumnComponent,
          _row?: RowComponent
        ): any {
          return data.relativeCost;
        },
      },
      {
        title: 'Row Count',
        field: 'rowCount',
        sorter: 'number',
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 120,
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
      {
        title: 'Aggregations',
        field: 'aggregations',
        sorter: 'number',
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
    ],
    rowFormatter: function (row) {
      const data = row.getData();
      if (data.isDetail && data.timestamp) {
        const detailContainer = createSOQLDetailPanel(data.timestamp, timestampToSOQl);
        row.getElement().replaceChildren(detailContainer);
      }
    },
  });

  soqlTable.on('tableBuilt', () => {
    soqlTable.setGroupBy('soql');
  });

  soqlTable.on('groupClick', (e: UIEvent, group: GroupComponent) => {
    if (!group.isVisible()) {
      soqlTable.blockRedraw();
      soqlTable.getRows().forEach((row) => {
        !row.isTreeExpanded() && row.treeExpand();
      });
      soqlTable.restoreRedraw();
    }
  });

  soqlTable.on('groupVisibilityChanged', (group: GroupComponent, visible: boolean) => {
    const firstRow = visible ? group.getRows()[0] : group.getRows()[0]?.getPrevRow();
    if (firstRow) {
      // @ts-expect-error it has 2 params
      firstRow.scrollTo('center', true).then(() => {
        firstRow
          .getElement()
          .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      });
    }
  });

  soqlTable.on('rowClick', function (e, row) {
    const data = row.getData();
    if (!(data.timestamp && data.soql)) {
      return;
    }

    const origRowHeight = row.getElement().offsetHeight;

    row.treeToggle();
    row.getCell('soql').getElement().style.height = origRowHeight + 'px';

    const nextRow = row.getNextRow() || row.getTreeChildren()[0];
    if (nextRow) {
      // @ts-expect-error it has 2 params
      nextRow.scrollTo('center', true).then(() => {
        nextRow.getElement().scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      });
    }
  });
}

function createDetailPanel(timestamp: number) {
  const detailContainer = document.createElement('div');
  detailContainer.className = 'callstack-wrapper';
  render(html`<call-stack timestamp=${timestamp}></call-stack>`, detailContainer);

  return detailContainer;
}

function createSOQLDetailPanel(
  timestamp: number,
  timestampToSOQl: Map<number, SOQLExecuteBeginLine>
) {
  const detailContainer = document.createElement('div');
  detailContainer.className = 'row__details-container';

  const soqlLine = timestampToSOQl.get(timestamp);
  render(
    html`<db-soql-detail-panel
      timestamp=${timestamp}
      soql=${soqlLine?.text}
    ></db-soql-detail-panel>`,
    detailContainer
  );

  return detailContainer;
}

function sortByFrequency(dataArray: string[]) {
  const map = new Map<string, number>();
  dataArray.forEach((val) => {
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
    const vscodeHost = hostService();
    if (vscodeHost) {
      vscodeHost.saveFile({ fileContent: fileContents, defaultFilename: defaultFileName });
      return false;
    }

    return new Blob([fileContents], { type: mimeType });
  };
}
