/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import {
  provideVSCodeDesignSystem,
  vsCodeCheckbox,
  vsCodeDropdown,
  vsCodeOption,
} from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Tabulator, type ColumnComponent, type RowComponent } from 'tabulator-tables';
import * as CommonModules from '../datagrid/module/CommonModules.js';

import NumberAccessor from '../datagrid/dataaccessor/Number.js';
import { progressFormatter } from '../datagrid/format/Progress.js';
import { RowKeyboardNavigation } from '../datagrid/module/RowKeyboardNavigation.js';
import dataGridStyles from '../datagrid/style/DataGrid.scss';
import { ApexLog, TimedNode } from '../parsers/ApexLogParser.js';
import { vscodeMessenger } from '../services/VSCodeExtensionMessenger.js';
import { globalStyles } from '../styles/global.styles.js';
import './skeleton/GridSkeleton.js';

import { Find, formatter } from '../components/calltree-view/module/Find.js';
import { RowNavigation } from '../datagrid/module/RowNavigation.js';

provideVSCodeDesignSystem().register(vsCodeCheckbox(), vsCodeDropdown(), vsCodeOption());

let analysisTable: Tabulator;
let tableContainer: HTMLDivElement | null;
let findMap: { [key: number]: RowComponent } = {};
let findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
  text: '',
  count: 0,
  options: { matchCase: false },
};
let totalMatches = 0;
@customElement('analysis-view')
export class AnalysisView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  get _tableWrapper(): HTMLDivElement | null {
    return (tableContainer = this.renderRoot?.querySelector('#analysis-table') ?? null);
  }

  constructor() {
    super();

    document.addEventListener('lv-find', this._find as EventListener);
    document.addEventListener('lv-find-match', this._find as EventListener);
    document.addEventListener('lv-find-close', this._find as EventListener);
  }

  updated(changedProperties: PropertyValues): void {
    if (this.timelineRoot && changedProperties.has('timelineRoot')) {
      this._appendTableWhenVisible();
    }
  }

  static styles = [
    unsafeCSS(dataGridStyles),
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
        gap: 1rem;
      }

      #analysis-table-container {
        display: contents;
        height: 100%;
      }

      .dropdown-container {
        box-sizing: border-box;
        display: flex;
        flex-flow: column nowrap;
        align-items: flex-start;
        justify-content: flex-start;
      }

      .dropdown-container label {
        display: block;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: var(--vscode-font-size);
        line-height: normal;
        margin-bottom: 2px;
      }
    `,
  ];

  render() {
    const skeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : '';

    return html`
      <div class="filter-container">
        <div class="dropdown-container">
          <label for="groupby-dropdown">Group by</label>
          <vscode-dropdown id="groupby-dropdown" @change="${this._groupBy}">
            <vscode-option>None</vscode-option>
            <vscode-option>Namespace</vscode-option>
            <vscode-option>Type</vscode-option>
          </vscode-dropdown>
        </div>
      </div>
      <div id="analysis-table-container">
        ${skeleton}
        <div id="analysis-table"></div>
      </div>
    `;
  }

  _groupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    const fieldName = target.value.toLowerCase();

    analysisTable.setGroupBy(fieldName !== 'none' ? fieldName : '');
  }

  _appendTableWhenVisible() {
    const rootMethod = this.timelineRoot;
    const tableWrapper = this._tableWrapper;
    if (tableWrapper && rootMethod) {
      const analysisObserver = new IntersectionObserver((entries, observer) => {
        const visible = entries[0]?.isIntersecting;
        if (visible) {
          renderAnalysis(rootMethod);
          observer.disconnect();
        }
      });
      analysisObserver.observe(tableWrapper);
    }
  }

  _find = (e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) => {
    const isTableVisible = !!analysisTable?.element?.clientHeight;
    if (!isTableVisible && !totalMatches) {
      return;
    }

    const newFindArgs = JSON.parse(JSON.stringify(e.detail));
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
      const result = analysisTable.find(findArgs);
      totalMatches = result.totalMatches;
      findMap = result.matchIndexes;

      if (!clearHighlights) {
        document.dispatchEvent(
          new CustomEvent('lv-find-results', { detail: { totalMatches: result.totalMatches } }),
        );
      }
    }

    const currentRow = findMap[findArgs.count];
    const rows = [currentRow, findMap[findArgs.count + 1], findMap[findArgs.count - 1]];
    rows.forEach((row) => {
      row?.reformat();
    });
    //@ts-expect-error This is a custom function added in by RowNavigation custom module
    analysisTable.goToRow(currentRow, { scrollIfVisible: false, focusRow: false });
  };
}

async function renderAnalysis(rootMethod: ApexLog) {
  if (!tableContainer) {
    return;
  }
  const methodMap: Map<string, Metric> = new Map();

  addNodeToMap(methodMap, rootMethod);
  const metricList = [...methodMap.values()];

  const headerMenu = [
    {
      label: 'Export to CSV',
      action: function (_e: PointerEvent, column: ColumnComponent) {
        column.getTable().download('csv', 'analysis.csv', { bom: true, delimiter: ',' });
      },
    },
  ];

  Tabulator.registerModule(Object.values(CommonModules));
  Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, Find]);
  analysisTable = new Tabulator(tableContainer, {
    rowKeyboardNavigation: true,
    selectableRows: 1,
    data: metricList,
    layout: 'fitColumns',
    placeholder: 'No Analysis Available',
    columnCalcs: 'both',
    clipboard: true,
    downloadEncoder: function (fileContents: string, mimeType) {
      const vscodeHost = vscodeMessenger.getVsCodeAPI();
      if (vscodeHost) {
        vscodeMessenger.send<VSCodeSaveFile>('saveFile', {
          fileContent: fileContents,
          options: {
            defaultFileName: 'analysis.csv',
          },
        });
        return false;
      }

      return new Blob([fileContents], { type: mimeType });
    },
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
    height: '100%',
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupToggleElement: 'header',
    rowFormatter: (row: RowComponent) => {
      formatter(row, findArgs);
    },
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
      headerMenu: headerMenu,
      headerWordWrap: true,
    },
    initialSort: [{ column: 'selfTime', dir: 'desc' }],
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
        title: 'Name',
        field: 'name',
        formatter: 'textarea',
        headerSortStartingDir: 'asc',
        sorter: 'string',
        cssClass: 'datagrid-code-text',
        bottomCalc: () => {
          return 'Total';
        },
        widthGrow: 5,
      },
      {
        title: 'Namespace',
        field: 'namespace',
        headerSortStartingDir: 'desc',
        width: 150,
        sorter: 'string',
        cssClass: 'datagrid-code-text',
        tooltip: true,
        headerFilter: 'list',
        headerFilterFunc: 'in',
        headerFilterParams: {
          valuesLookup: 'all',
          clearable: true,
          multiselect: true,
        },
        headerFilterLiveFilter: false,
      },
      {
        title: 'Type',
        field: 'type',
        headerSortStartingDir: 'asc',
        width: 150,
        sorter: 'string',
        tooltip: true,
        cssClass: 'datagrid-code-text',
      },
      {
        title: 'Count',
        field: 'count',
        sorter: 'number',
        width: 65,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      {
        title: 'Total Time (ms)',
        field: 'totalTime',
        sorter: 'number',
        width: 165,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: progressFormatter,
        formatterParams: {
          thousand: false,
          precision: 3,
          totalValue: rootMethod.duration.total,
        },
        accessorDownload: NumberAccessor,
        bottomCalcFormatter: progressFormatter,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration.total },
      },
      {
        title: 'Self Time (ms)',
        field: 'selfTime',
        sorter: 'number',
        width: 165,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration.total },
        formatter: progressFormatter,
        formatterParams: {
          thousand: false,
          precision: 3,
          totalValue: rootMethod.duration.total,
        },
        accessorDownload: NumberAccessor,
        bottomCalcFormatter: progressFormatter,
      },
    ],
  });
}

export class Metric {
  name: string;
  type;
  count = 0;
  totalTime = 0;
  selfTime = 0;
  namespace;

  constructor(node: TimedNode) {
    this.name = node.text;
    this.type = node.type;
    this.namespace = node.namespace;
  }
}

function addNodeToMap(map: Map<string, Metric>, node: TimedNode, key?: string) {
  const children = node.children;

  if (key) {
    let metric = map.get(key);
    if (!metric) {
      metric = new Metric(node);
      map.set(key, metric);
    }

    ++metric.count;
    metric.totalTime += node.duration.total;
    metric.selfTime += node.duration.self;
  }

  children.forEach(function (child) {
    if (child instanceof TimedNode) {
      addNodeToMap(map, child, child.namespace + child.text);
    }
  });
}

type VSCodeSaveFile = {
  fileContent: string;
  options: {
    defaultFileName: string;
  };
};
