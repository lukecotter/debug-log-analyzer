/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { WebviewPanel } from "vscode";
import { Context } from "../Context";
import { OpenFileInPackage } from "../display/OpenFileInPackage";
import { WebView } from "../display/WebView";
import * as path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";

interface WebViewLogFileRequest {
  cmd: string;
  text: string | undefined;
  typeName: string | undefined;
  path: string | undefined;
}

export class LogFileException extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = "LogFileException";
  }
}

export class LogView {
  private static HELP_URL = 'https://financialforcedev.github.io/debug-log-analyzer/';

  static async createView(
    wsPath: string,
    context: Context,
    logPath: string
  ): Promise<WebviewPanel> {
    const panel = WebView.apply("logFile", "Log: " + path.basename(logPath), [
      vscode.Uri.file(path.join(context.context.extensionPath, "out")),
      vscode.Uri.file(path.dirname(logPath)),
    ]);
    panel.webview.onDidReceiveMessage(
      (msg: any) => {
        const request = msg as WebViewLogFileRequest;

        switch (request.cmd) {
          case "openPath":
            if (request.path) {
              context.display.showFile(request.path);
            }
            break;

          case "openType": {
            if (request.typeName) {
              const parts = request.typeName.split("-");
              let line;
              if (parts.length > 1) {
                line = parseInt(parts[1]);
              }
              OpenFileInPackage.openFileForSymbol(
                wsPath,
                context,
                parts[0],
                line
              );
            }
            break;
          }

          case "openHelp": {
            vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(this.HELP_URL));
            break;
          }
        }
      },
      undefined,
      []
    );

    return panel;
  }

  static async appendView(
    view: WebviewPanel,
    context: Context,
    logName: string,
    logPath: string
  ): Promise<WebviewPanel> {
    view.webview.html = await LogView.getViewContent(
      view,
      context,
      logName,
      logPath
    );
    return view;
  }

  private static async getViewContent(
    view: WebviewPanel,
    context: Context,
    logName: string,
    logPath: string
  ): Promise<string> {
    const namespaces = context.namespaces;
    const logViewerRoot = path.join(context.context.extensionPath, "out");
    const index = path.join(logViewerRoot, "index.html");
    const bundleUri = view.webview.asWebviewUri(
      vscode.Uri.file(path.join(logViewerRoot, "bundle.js"))
    );
    const logPathUri = view.webview.asWebviewUri(vscode.Uri.file(logPath));

    const indexSrc = await fs.readFile(index, "utf-8");
    const toReplace: { [key: string]: string } = {
      "@@name": logName,
      "@@path": logPath,
      "@@ns": namespaces.join(","),
      "bundle.js": bundleUri.toString(true),
      "sample.log": logPathUri.toString(true),
    };

    return indexSrc.replace(
      /@@name|@@path|@@ns|bundle.js|sample.log/gi,
      function (matched) {
        return toReplace[matched];
      }
    );
  }
}