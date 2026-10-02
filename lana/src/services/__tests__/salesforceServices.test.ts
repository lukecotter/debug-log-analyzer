/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { getLogBody, listLogs } from '../salesforceServices.js';
import { getRuntime, getServicesApi } from '../servicesRuntime.js';

vi.mock('../servicesRuntime.js', async () => ({
  getRuntime: vi.fn(),
  getServicesApi: vi.fn(),
}));

const mockRunPromise = vi.fn();
const mockListLogs = vi.fn((limit: number) => ({ limit }));
const mockGetLogBody = vi.fn((id: string) => ({ id }));

beforeEach(() => {
  (getRuntime as vi.Mock).mockReturnValue({ runPromise: mockRunPromise });
  (getServicesApi as vi.Mock).mockReturnValue({
    services: { ApexLogService: { listLogs: mockListLogs, getLogBody: mockGetLogBody } },
  });
});

describe('listLogs', () => {
  it('forwards the abort signal to the runtime so a dismissal really cancels', () => {
    const signal = new AbortController().signal;

    void listLogs(signal);

    expect(mockRunPromise).toHaveBeenCalledWith(expect.anything(), { signal });
  });

  it('asks for the record limit', () => {
    void listLogs(undefined, 50);

    expect(mockListLogs).toHaveBeenCalledWith(50);
  });
});

describe('getLogBody', () => {
  it('runs without a signal', () => {
    void getLogBody('07L000000000001');

    expect(mockRunPromise).toHaveBeenCalledWith(expect.anything());
  });
});
