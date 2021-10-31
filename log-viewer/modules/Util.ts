/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { encodeEntities } from "./Browser.js";
import { LogLine } from "./parsers/LineParser.js";

export function highlightText(unsafeText: string, isBold: boolean) {
  const text = encodeEntities(unsafeText);
  return isBold ? "<b>" + text + "</b>" : text;
}

export default function formatDuration(duration: number) {
  const text = `${~~(duration / 1000)}`; // convert from nano-seconds to micro-seconds
  const textPadded =
    text.length < 4 ? "0000".substring(text.length) + text : text; // length min = 4
  const millis = textPadded.slice(0, -3); // everything before last 3 chars
  const micros = textPadded.slice(-3); // last 3 chars
  return `${millis}.${micros}ms`;
}

export function showTab(tabId: string) {
  const tabHolder = document.querySelector(".tabHolder"),
    tab = document.getElementById(tabId),
    tabber = document.querySelector(".tabber"),
    show = tab?.dataset.show,
    tabItem = show ? document.getElementById(show) : null;

  tabHolder
    ?.querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("selected"));
  tab?.classList.add("selected");
  tabber
    ?.querySelectorAll(".tabItem")
    .forEach((t) => t.classList.remove("selected"));
  if (tabItem) {
    tabItem.classList.add("selected");
  }
}

export function recalculateDurations(node: LogLine) {
  if (node.exitStamp) {
    node.netDuration = node.duration = node.exitStamp - node.timestamp;
    if (node.children) {
      const len = node.children.length;
      for (let i = 0; i < len; ++i) {
        const duration = node.children[i].duration;

        if (duration) {
          node.netDuration -= duration;
        }
      }
    }
  }
}