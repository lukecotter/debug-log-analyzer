/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';

import { createMockExtensionContext } from './mocks/vscode.js';
import { Context } from '../Context.js';
import { Display } from '../display/Display.js';
import { activate, deactivate } from '../Main.js';
import { disposeServices, initServices } from '../services/servicesRuntime.js';

vi.mock('../Context.js', async () => ({ Context: vi.fn() }));
vi.mock('../display/Display.js', async () => ({ Display: vi.fn() }));
vi.mock('../services/servicesRuntime.js', async () => ({
  disposeServices: vi.fn(),
  initServices: vi.fn(),
}));

const mockContext = Context as vi.Mock;
const mockDisplay = Display as vi.Mock;
const mockDisposeServices = disposeServices as vi.Mock;
const mockInitServices = initServices as vi.Mock;

describe('Main', () => {
  it('activates without initializing Salesforce Services', () => {
    const extensionContext = createMockExtensionContext();

    activate(extensionContext as unknown as import('vscode').ExtensionContext);

    expect(mockDisplay).toHaveBeenCalledWith();
    expect(mockContext).toHaveBeenCalledWith(extensionContext, expect.anything());
    expect(mockInitServices).not.toHaveBeenCalled();
  });

  it('deactivates without loading the Salesforce Services chunk', () => {
    deactivate();

    expect(mockDisposeServices).not.toHaveBeenCalled();
  });
});
