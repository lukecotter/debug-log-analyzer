/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { RootNode } from "./parsers/TreeParser.js";
import { LogLine } from "./parsers/LineParser.js";
import formatDuration, { showTab } from "./Util.js";
import { hostService, OpenInfo } from "./services/VSCodeService.js";

let treeRoot: RootNode;
const divElem = document.createElement("div");
const spanElem = document.createElement("span");
const linkElem = document.createElement("a");

function onExpandCollapse(evt: Event) {
  const input = evt.target as HTMLElement;
  if (input.classList.contains("toggle")) {
    const pe = input.parentElement,
      toggle = pe?.querySelector(".toggle");
    let childContainer = pe?.querySelector<HTMLElement>(".childContainer");

    const timestamp = pe?.dataset.enterstamp;
    if (!childContainer && timestamp) {
      const node = findByTimeStamp(treeRoot, timestamp);
      childContainer = node?.children
        ? createChildNodes(node?.children, [node.timestamp])
        : null;
      if (childContainer) {
        pe.appendChild(childContainer);
      }

      showHideDetails();
    }

    if (toggle && childContainer) {
      switch (toggle.textContent) {
        case "+":
          // expand
          childContainer.classList.remove("hide");
          toggle.textContent = "-";
          break;
        case "-":
          // collapse
          childContainer.classList.add("hide");
          toggle.textContent = "+";
          break;
      }
    }
  }
}

export function showTreeNode(timestamp: number) {
  const methodElm = renderCallStack(timestamp);
  showHideDetails();
  if (methodElm) {
    const methodName = methodElm?.querySelector("span.name") || methodElm;
    showTab("treeTab");
    expandTreeNode(methodElm, false);
    methodElm.scrollIntoView(false);
    if (methodName) {
      document.getSelection()?.selectAllChildren(methodName);
    }
  }
}

function renderCallStack(timestamp: number) {
  let methodElm = document.querySelector(
    `div[data-enterstamp="${timestamp}"]`
  ) as HTMLElement;

  if (!methodElm) {
    let nodeToAttachTo;
    let nodeToStartAt;

    const callstack = findCallstack(treeRoot, timestamp) || [];
    const len = callstack.length;
    for (let i = 0; i < len; i++) {
      const node = callstack[i];
      if (node) {
        const isRendered = document.querySelector(
          `div[data-enterstamp="${node.timestamp}"]`
        ) as HTMLElement;
        if (isRendered) {
          nodeToAttachTo = isRendered;
          nodeToStartAt = node;
          continue;
        }
        break;
      }
    }

    const timeStamps = callstack.map((node) => {
      if (node?.timestamp) {
        return node.timestamp;
      }
    }) as number[];

    if (nodeToStartAt?.children && nodeToAttachTo) {
      const childContainer = createChildNodes(
        nodeToStartAt.children,
        timeStamps
      );
      if (childContainer) {
        nodeToAttachTo.appendChild(childContainer);
      }

      methodElm = document.querySelector(
        `div[data-enterstamp="${timestamp}"]`
      ) as HTMLElement;
    }
  }
  return methodElm;
}

function findCallstack(node: LogLine, timeStamp: number): LogLine[] | null {
  if (node.timestamp === timeStamp) {
    return [node];
  }

  const children = node?.children || [];
  const len = children.length;
  for (let i = 0; i < len; i++) {
    const child = children[i];
    const timeStamps = findCallstack(child, timeStamp);
    if (timeStamps) {
      timeStamps.unshift(child);
      return timeStamps;
    }
  }
  return null;
}

function expandTreeNode(elm: HTMLElement, expand: boolean) {
  const elements = [];
  let element: HTMLElement | null = expand ? elm : elm.parentElement;
  while (element && element.id !== "tree") {
    if (element.id) {
      elements.push(element);
    }
    element = element.parentElement;
  }

  const len = elements.length;
  for (let i = 0; i < len; i++) {
    const elem = elements[i];
    const toggle = elem.querySelector(`:scope > .toggle`),
      childContainer = elem.querySelector(
        `:scope > .childContainer`
      ) as HTMLElement;

    if (toggle) {
      childContainer.classList.remove("hide");
      toggle.textContent = "-";
    }
  }
}

function describeMethod(node: LogLine) {
  const methodPrefix = node.prefix || "",
    methodSuffix = node.suffix || "";

  const dbPrefix =
    (node.containsDml ? "D" : "") + (node.containsSoql ? "S" : "");
  const linePrefix = (dbPrefix ? `(${dbPrefix}) ` : "") + methodPrefix;

  let lineSuffix = "";
  if (node.displayType === "method") {
    const nodeValue = node.value ? ` = ${node.value}` : "";
    const timeTaken = node.truncated
      ? "TRUNCATED"
      : `${formatDuration(node.duration || 0)} (${formatDuration(
          node.netDuration || 0
        )})`;
    const lineNumber = node.lineNumber ? `, line: ${node.lineNumber}` : "";
    lineSuffix = `${nodeValue}${methodSuffix} - ${timeTaken}${lineNumber}`;
  }

  const text = node.text;
  let logLineBody;
  if (hasCodeText(node)) {
    logLineBody = linkElem.cloneNode() as HTMLAnchorElement;
    logLineBody.href = "#";
    logLineBody.textContent = text;
  } else {
    return [document.createTextNode(linePrefix + text + lineSuffix)];
  }

  const nodeResults = [document.createTextNode(linePrefix), logLineBody];
  if (lineSuffix) {
    nodeResults.push(document.createTextNode(lineSuffix));
  }
  return nodeResults;
}

function renderBlock(childContainer: HTMLDivElement, block: LogLine) {
  const lines = block.children ?? [],
    len = lines.length;

  for (let i = 0; i < len; ++i) {
    const line = lines[i],
      lineNode = divElem.cloneNode() as HTMLDivElement;
    lineNode.className =
      line.hideable !== false ? "block detail hide" : "block";

    const value = line.text || "";
    let text = line.type + (value && value !== line.type ? " - " + value : "");
    text = text.replace(/ \| /g, "\n");
    if (text.endsWith("\\")) {
      text = text.slice(0, -1);
    }

    lineNode.textContent = text;
    childContainer.appendChild(lineNode);
  }
}

function hasCodeText(node: LogLine): boolean {
  return node.type === "METHOD_ENTRY" || node.type === "CONSTRUCTOR_ENTRY";
}

function deriveOpenInfo(node: LogLine): OpenInfo | null {
  if (!hasCodeText(node)) {
    return null;
  }

  const text = node.text;
  let lineNumber = "";
  if (node.lineNumber) {
    lineNumber = "-" + node.lineNumber;
  }

  let qname = text.substr(0, text.indexOf("("));
  if (node.type === "METHOD_ENTRY") {
    const lastDot = qname.lastIndexOf(".");
    return {
      typeName: text.substr(0, lastDot) + lineNumber,
      text: text,
    };
  } else {
    return {
      typeName: qname + lineNumber,
      text: text,
    };
  }
}

function renderTreeNode(node: LogLine, timeStamps: number[]) {
  const children = node.children ?? [];

  const mainNode = divElem.cloneNode() as HTMLDivElement;
  if (node.timestamp >= 0) {
    mainNode.dataset.enterstamp = "" + node.timestamp;
    mainNode.id = `calltree-${node.timestamp}`;
  }
  mainNode.className = node.classes || "";

  const len = children.length;
  if (len) {
    const toggle = spanElem.cloneNode() as HTMLSpanElement;
    toggle.textContent = "+";
    toggle.className = "toggle";
    mainNode.appendChild(toggle);
  } else {
    mainNode.classList.add("indent");
  }

  const titleSpan = spanElem.cloneNode() as HTMLSpanElement;
  titleSpan.className = "name";
  const titleElements = describeMethod(node);
  const elemsLen = titleElements.length;
  for (let i = 0; i < elemsLen; i++) {
    titleSpan.appendChild(titleElements[i]);
  }
  mainNode.appendChild(titleSpan);

  if (len && (timeStamps.includes(node.timestamp) || timeStamps.includes(-1))) {
    const childContainer = createChildNodes(children, timeStamps);
    if (childContainer) {
      mainNode.appendChild(childContainer);
    }
  }

  return mainNode;
}

function createChildNodes(children: LogLine[], timeStamps: number[]) {
  const childContainer = divElem.cloneNode() as HTMLDivElement;
  childContainer.className = "childContainer hide";
  const len = children.length;
  for (let i = 0; i < len; ++i) {
    const child = children[i];
    switch (child.displayType) {
      case "method":
        const container = renderTreeNode(child, timeStamps);
        if (container) {
          childContainer.appendChild(container);
        }
        break;
      case "block":
        renderBlock(childContainer, child);
        break;
    }
  }
  return childContainer;
}

function renderTree() {
  const treeContainer = document.getElementById("tree");
  if (treeContainer) {
    treeContainer.addEventListener("click", onExpandCollapse);
    treeContainer.addEventListener("click", goToFile);

    const callTreeNode = renderTreeNode(treeRoot, [0]);
    treeContainer.innerHTML = "";
    if (callTreeNode) {
      treeContainer.appendChild(callTreeNode);
      showHideDetails();
    }
  }
}

function goToFile(evt: Event) {
  const elem = evt.target as HTMLElement;
  const target = elem.matches("a") ? elem.parentElement?.parentElement : null;
  const timeStamp = target?.dataset.enterstamp;
  if (timeStamp) {
    const node = findByTimeStamp(treeRoot, timeStamp);
    if (node) {
      const fileOpenInfo = deriveOpenInfo(node);
      if (fileOpenInfo) {
        hostService().openType(fileOpenInfo);
      }
    }
  }
}

function findByTimeStamp(node: LogLine, timeStamp: string): LogLine | null {
  if (node) {
    if (node.timestamp === parseInt(timeStamp)) {
      return node;
    }

    if (node.children) {
      const len = node.children.length;
      for (let i = 0; i < len; ++i) {
        const target = findByTimeStamp(node.children[i], timeStamp);
        if (target) {
          return target;
        }
      }
    }
  }
  return null;
}

export default async function renderTreeView(rootMethod: RootNode) {
  treeRoot = rootMethod;
  renderTree();
}

function expand(elm: HTMLElement) {
  const toggles = elm.querySelectorAll(".toggle");
  toggles.forEach((toggle) => {
    toggle.textContent = "-";
  });

  const childContainers =
    document.querySelectorAll<HTMLElement>(".childContainer");
  childContainers.forEach((childContainer) => {
    if (!childContainer.classList.contains("block")) {
      childContainer.classList.remove("hide");
    }
  });
}

function renderLowest(elm: HTMLElement) {
  const toggle = elm.querySelector(`:scope > .toggle`),
    childContainer = elm.querySelector(
      `:scope > .childContainer`
    ) as HTMLElement;

  if (toggle && !childContainer && elm.dataset.enterstamp) {
    const node = findByTimeStamp(treeRoot, elm.dataset.enterstamp || "");

    if (node?.children) {
      const childContainer = createChildNodes(node.children, [-1]);
      elm.appendChild(childContainer);
    }
  } else if (elm.children) {
    const len = elm.children.length;
    for (let i = 0; i < len; ++i) {
      renderLowest(elm.children[i] as HTMLElement);
    }
  }
}

function collapse(elm: HTMLElement) {
  const toggles = document.querySelectorAll(".toggle");
  toggles.forEach((toggle) => {
    toggle.textContent = "+";
  });

  const childContainers = elm.querySelectorAll<HTMLElement>(".childContainer");
  childContainers.forEach((childContainer) => {
    if (!childContainer.classList.contains("block")) {
      childContainer.classList.add("hide");
    }
  });
}

let previouslyExpanded = false;
function onExpandAll(evt: Event) {
  const treeContainer = document.getElementById("tree");
  if (!previouslyExpanded) {
    renderLowest(treeContainer as HTMLElement);
    previouslyExpanded = true;
  }
  if (treeContainer) {
    showHideDetails();
    expand(treeContainer);
  }
}

function onCollapseAll(evt: Event) {
  const treeContainer = document.getElementById("tree");
  if (treeContainer) {
    collapse(treeContainer);
  }
}

function hideBySelector(selector: string, hide: boolean) {
  const elements = document.querySelectorAll<HTMLElement>(selector);

  const hideElm = function (elem: HTMLElement) {
    elem.classList.add("hide");
  };

  const showElm = function (elem: HTMLElement) {
    elem.classList.remove("hide");
  };

  const hideByFunc = hide ? hideElm : showElm;
  elements.forEach(hideByFunc);
}

function onHideDetails(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector("#tree .detail", input.checked);
}

function showHideDetails() {
  const hideDetails = document.getElementById(
      "hideDetails"
    ) as HTMLInputElement,
    hideSystem = document.getElementById("hideSystem") as HTMLInputElement,
    hideFormula = document.getElementById("hideFormula") as HTMLInputElement;

  hideBySelector("#tree .detail", hideDetails?.checked);
  hideBySelector("#tree .node.system", hideSystem?.checked);
  hideBySelector("#tree .node.formula", hideFormula?.checked);
}

function onHideSystem(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector("#tree .node.system", input.checked);
}

function onHideFormula(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector("#tree .node.formula", input.checked);
}

function onInitTree(evt: Event) {
  const expandAll = document.getElementById("expandAll"),
    collapseAll = document.getElementById("collapseAll"),
    hideDetails = document.getElementById("hideDetails"),
    hideSystem = document.getElementById("hideSystem"),
    hideFormula = document.getElementById("hideFormula");

  expandAll?.addEventListener("click", onExpandAll);
  collapseAll?.addEventListener("click", onCollapseAll);
  hideDetails?.addEventListener("change", onHideDetails);
  hideSystem?.addEventListener("change", onHideSystem);
  hideFormula?.addEventListener("change", onHideFormula);
}

window.addEventListener("DOMContentLoaded", onInitTree);