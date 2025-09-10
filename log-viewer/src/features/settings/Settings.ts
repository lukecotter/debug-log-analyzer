/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { vscodeMessenger } from '../../core/messaging/VSCodeExtensionMessenger.js';

/* eslint-disable @typescript-eslint/naming-convention */
export type LanaSettings = {
  timeline: {
    colors: {
      'Code Unit': '#88AE58';
      Workflow: '#51A16E';
      Method: '#2B8F81';
      Flow: '#337986';
      DML: '#285663';
      SOQL: '#5D4963';
      'System Method': '#5C3444';
    };
    experimental: { timeline: boolean };
  };
};

export function getSettings(): Promise<LanaSettings> {
  return vscodeMessenger.request<LanaSettings>('getConfig').then((msg) => {
    return msg;
  });
}
