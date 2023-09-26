/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
// import codiconStyles from '@vscode/codicons/dist/codicon.css';
import {
  provideVSCodeDesignSystem,
  vsCodePanelTab,
  vsCodePanelView,
  vsCodePanels,
} from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '../analysis-view/AnalysisView';
import '../calltree-view/CalltreeView';
import '../database-view/DatabaseView';
import { globalStyles } from '../global.styles';
import '../log-levels/LogLevels';
import '../navbar/NavBar';
import { Notification } from '../notifications/NotificationPanel';
// import { codiconStyles } from '../styles/codicon.styles';
import codiconStyles from '../styles/codicon.css';
import { RootNode } from '../timeline/Timeline';
import '../timeline/TimelineView';

provideVSCodeDesignSystem().register(vsCodePanelTab(), vsCodePanelView(), vsCodePanels());

@customElement('app-header')
export class AppHeader extends LitElement {
  @property({ type: String })
  logName = '';
  @property()
  logPath = '';
  @property()
  logSize = null;
  @property()
  logDuration = null;
  @property()
  logStatus = 'Processing...';
  @property()
  notifications: Notification[] = [];
  @property()
  timelineRoot: RootNode | null = null;

  @state()
  _selectedTab = 'timeline-tab';

  constructor() {
    super();
    document.addEventListener('show-tab', (e: Event) => {
      this._showTabEvent(e);
    });
  }

  static styles = [
    globalStyles,
    unsafeCSS(codiconStyles),
    css`
      :host {
        background-color: var(--vscode-tab-activeBackground);
        box-shadow: inset 0 calc(max(1px, 0.0625rem) * -1)
          var(--vscode-panelSectionHeader-background);
        display: flex;
        flex-direction: column;
        height: 100%;

        --panel-tab-active-foreground: var(--vscode-panelTitle-activeBorder);
        --panel-tab-selected-text: var(--vscode-panelTitle-activeForeground, #e7e7e7);
      }

      vscode-panels {
        height: 100%;
      }

      vscode-panels::part(tabpanel) {
        overflow: auto;
        box-shadow: inset 0 calc(max(1px, 0.0625rem) * 1)
          var(--vscode-panelSectionHeader-background);
      }

      vscode-panel-view {
        height: 100%;
      }

      vscode-panel-tab[aria-selected='true'] {
        color: var(--panel-tab-selected-text);
      }

      vscode-panel-tab:hover {
        color: var(--panel-tab-selected-text);
      }
    `,
  ];

  render() {
    return html`
      <nav-bar
        .logName=${this.logName}
        .logPath=${this.logPath}
        .logSize=${this.logSize}
        .logDuration=${this.logDuration}
        .logStatus=${this.logStatus}
        .notifications=${this.notifications}
      ></nav-bar>
      <log-levels></log-levels>
      <vscode-panels activeid="${this._selectedTab}">
        <vscode-panel-tab
          id="timeline-tab"
          data-show="timeline-view"
          @click="${this._showTabHTMLElem}"
        >
          <span class="codicon codicon-graph">&nbsp;</span>
          <span>Timeline</span>
        </vscode-panel-tab>
        <vscode-panel-tab
          id="tree-tab"
          data-show="call-tree-view"
          @click="${this._showTabHTMLElem}"
        >
          <span class="codicon codicon-list-tree">&nbsp;</span>
          <span>Call Tree</span>
        </vscode-panel-tab>
        <vscode-panel-tab
          id="analysis-tab"
          data-show="analysis-view"
          @click="${this._showTabHTMLElem}"
        >
          <span class="codicon codicon-code">&nbsp;</span>
          <span>Analysis</span>
        </vscode-panel-tab>
        <vscode-panel-tab id="database-tab" data-show="db-view" @click="${this._showTabHTMLElem}">
          <span class="codicon codicon-database">&nbsp;</span>
          <span>Database</span>
        </vscode-panel-tab>

        <vscode-panel-view id="view1">
          <timeline-view .timelineRoot="${this.timelineRoot}"></timeline-view>
        </vscode-panel-view>
        <vscode-panel-view id="view2">
          <call-tree-view .timelineRoot="${this.timelineRoot}"></call-tree-view>
        </vscode-panel-view>
        <vscode-panel-view id="view3">
          <analysis-view .timelineRoot="${this.timelineRoot}"> </analysis-view>
        </vscode-panel-view>
        <vscode-panel-view id="view4">
          <database-view .timelineRoot="${this.timelineRoot}"></database-view>
        </vscode-panel-view>
      </vscode-panels>
    `;
  }

  _showTabHTMLElem(e: Event) {
    const input = e.target as HTMLElement;
    this._showTab(input.id);
  }

  _showTabEvent(e: Event) {
    const tabId = (e as CustomEvent).detail.tabid;
    this._showTab(tabId);
  }

  _showTab(tabId: string) {
    if (this._selectedTab !== tabId) {
      this._selectedTab = tabId;
    }
  }
}
