/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { idsOf, idOf, rawStoreOf, storeOf } from '#test-helpers/apexLog.js';
import type { LogIndex } from '../LogIndex.js';
import {
  currentLogStore,
  filterByLevels,
  LogStore,
  logStoreFor,
  setCurrentLog,
} from '../LogStore.js';

describe('LogStore', () => {
  it('resolves stack by eventId when timestamps are duplicated', async () => {
    const { log, store } = await storeOf(
      '09:18:22.6 (7000000)|METHOD_ENTRY|[1]|01p|ns.ClassOne.first()\n' +
        '09:18:22.6 (7100000)|METHOD_EXIT|[1]|ns.ClassOne.first()\n' +
        '09:18:22.6 (7000000)|METHOD_ENTRY|[2]|01p|ns.ClassTwo.second()\n' +
        '09:18:22.6 (7200000)|METHOD_EXIT|[2]|ns.ClassTwo.second()\n',
    );
    const [methodTwo] = idsOf(log, 'ns.ClassTwo.second()');

    const stack = store.stackById(methodTwo!);
    expect(stack[stack.length - 1]?.text).toBe('ns.ClassTwo.second()');
  });

  it('counts a VF call with no method as a stack frame', async () => {
    const { log, store } = await storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Page.load()\n' +
        '09:18:22.6 (2000)|VF_APEX_CALL_START|[EXTERNAL]|PageMessagesComponentController invoke(getseverities)\n' +
        '09:18:22.6 (3000)|METHOD_EXIT|[1]|ns.Page.load()\n',
    );

    const stack = store.stackById(
      idOf(log, 'PageMessagesComponentController invoke(getseverities)'),
    );

    expect(stack.slice(-2).map((frame) => frame.text)).toEqual([
      'ns.Page.load()',
      'PageMessagesComponentController invoke(getseverities)',
    ]);
  });

  it('keeps the limit block a limit line sits in on the stack', async () => {
    const { log, store } = await storeOf(
      '09:18:22.6 (1000)|CUMULATIVE_LIMIT_USAGE\n' +
        '09:18:22.6 (1000)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 0 out of 100\n' +
        '09:18:22.6 (2000)|CUMULATIVE_LIMIT_USAGE_END\n',
    );
    const limitLine = Array.from({ length: log.eventCount }, (_, i) => i + 1).find(
      (id) => log.event(id)?.type === 'LIMIT_USAGE_FOR_NS',
    );

    const stack = store.stackById(limitLine!);

    expect(stack.at(-1)?.type).toBe('CUMULATIVE_LIMIT_USAGE');
  });

  it('gives one log one store, whichever view asks', async () => {
    const { log } = await storeOf('');

    expect(logStoreFor(log)).toBe(logStoreFor(log));
    expect(setCurrentLog(logStoreFor(log))).toBe(currentLogStore());
    expect(currentLogStore()?.log).toBe(log);
  });

  // A path given leaf-first, or without the event itself, opens the wrong row.
  it('gives the ids from the top of the log down to an event, the event last', async () => {
    const { log, store } = await rawStoreOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|METHOD_ENTRY|[2]|01p|ns.Inner.go()\n' +
        '09:18:22.6 (1150)|USER_DEBUG|[3]|DEBUG|hello\n' +
        '09:18:22.6 (1200)|METHOD_EXIT|[2]|ns.Inner.go()\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const outer = idOf(log, 'ns.Outer.run()');
    const inner = idOf(log, 'ns.Inner.go()');
    const debug = idOf(log, 'DEBUG | hello');

    expect(store.pathTo(debug)).toEqual([outer, inner, debug]);
    expect(store.pathTo(0)).toEqual([]);
  });

  it('links a log filtered by level to the store of the log as captured', async () => {
    const { store } = await storeOf(
      '09:18:22.6 (1000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (1200)|SOQL_EXECUTE_END|[2]|Rows:1\n',
      '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,FINEST\n',
    );
    const filtered = (await filterByLevels(store, { database: 'WARN' }))!; // no signal, so never null

    expect(store.captured).toBe(store);
    expect(filtered.captured).toBe(store);
    expect(store.levelGap('queries')).toBeNull();
    expect(filtered.levelGap('queries')).toMatchObject({ kind: 'filtered', chosen: 'WARN' });
  });
});

describe('LogStore.withoutDetails', () => {
  const LOG =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (1100)|USER_DEBUG|[2]|DEBUG|hello\n' +
    '09:18:22.6 (1150)|HEAP_ALLOCATE|[3]|Bytes:100\n' +
    '09:18:22.6 (1200)|DML_BEGIN|[4]|Op:Insert|Type:Account|Rows:2\n' +
    '09:18:22.6 (1300)|DML_END|[4]\n' +
    '09:18:22.6 (1350)|EXCEPTION_THROWN|[5]|System.DmlException: boom\n' +
    '09:18:22.6 (1400)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  const eventIdsOf = async (store: LogStore) => [...(await store.logIndex()).eventId];
  const idOfType = (log: ApexLog, type: string) =>
    Array.from({ length: log.eventCount }, (_, i) => i + 1).find(
      (id) => log.event(id)?.type === type,
    );

  // A detail row left in the index is what makes the Bottom-Up tree 1.2 GB on a large log.
  it('indexes only the frames and pinned events, and leaves the source store whole', async () => {
    const { log, store } = await rawStoreOf(LOG);
    const outer = idOf(log, 'ns.Outer.run()');
    const dml = idOfType(log, 'DML_BEGIN');
    const thrown = idOf(log, 'System.DmlException: boom');

    const shown = store.withoutDetails();

    expect(await eventIdsOf(shown)).toEqual([outer, dml, thrown]);
    expect(shown.isShown(idOf(log, 'DEBUG | hello'))).toBe(false);
    expect((await store.logIndex()).rowCount).toBe(log.eventCount);
    expect(store.withoutDetails()).toBe(shown);
    expect(shown.withoutDetails()).toBe(shown);
  });

  // With Details off, the bytes a HEAP_ALLOCATE took are the frame's own.
  it('adds the heap of a hidden allocation to its frame, and leaves time and counts', async () => {
    const { log, store } = await rawStoreOf(LOG);
    const outer = idOf(log, 'ns.Outer.run()');
    const heap = log.columns.heapAllocated!; // FINEST levels record heap
    const dml = log.columns.dmlCount!; // FINEST levels record DML
    const full = await store.logIndex();
    const shown = await store.withoutDetails().logIndex();
    const before = full.rowOf(outer);
    const after = shown.rowOf(outer);

    expect(shown.selfColumn(heap.self)[after]).toBe(full.selfColumn(heap.self)[before]! + 100);
    expect(shown.self[after]).toBe(full.self[before]);
    expect(shown.selfColumn(dml.self)[after]).toBe(full.selfColumn(dml.self)[before]);
  });

  it('hides what the chosen levels hide as well as the details', async () => {
    const { log, store } = await rawStoreOf(LOG);
    const outer = idOf(log, 'ns.Outer.run()');
    const thrown = idOf(log, 'System.DmlException: boom');
    const filtered = (await filterByLevels(store, { database: 'WARN' }))!; // no signal, so never null

    const shown = filtered.withoutDetails();

    expect(await eventIdsOf(shown)).toEqual([outer, thrown]);
    expect(shown.captured).toBe(store);
    expect(shown.debugLevels).toBe(filtered.debugLevels);
  });
});

describe('LogStore.derive', () => {
  const LOG = '09:18:22.6 (1000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n';
  const rowCount = (index: LogIndex) => index.rowCount;
  const categoryNames = (index: LogIndex) => index.categoryNames;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs a derivation once per log and shares it with every caller', async () => {
    const { store } = await storeOf(LOG);
    const derive = jest.fn(rowCount);

    const [first, second] = await Promise.all([store.derive(derive), store.derive(derive)]);
    const later = await store.derive(derive);

    const { rowCount: rows } = await store.logIndex();
    expect(first).toBe(rows);
    expect(second).toBe(rows);
    expect(later).toBe(rows);
    expect(derive).toHaveBeenCalledTimes(1);
  });

  it('keeps each derivation apart', async () => {
    const { store } = await storeOf(LOG);

    const index = await store.logIndex();

    expect(await store.derive(rowCount)).toBe(index.rowCount);
    expect(await store.derive(categoryNames)).toBe(index.categoryNames);
  });

  it('forgets a failed derivation, so the next caller runs it again', async () => {
    const { store } = await storeOf(LOG);
    const failure = new Error('index build failed');
    jest.spyOn(LogStore.prototype, 'logIndex').mockRejectedValueOnce(failure);

    await expect(store.derive(rowCount)).rejects.toBe(failure);
    expect(await store.derive(rowCount)).toBe((await store.logIndex()).rowCount);
  });

  it('forgets a derivation that throws', async () => {
    const { store } = await storeOf(LOG);
    const failure = new Error('derivation failed');
    const derive = jest.fn(rowCount).mockImplementationOnce(() => {
      throw failure;
    });

    await expect(store.derive(derive)).rejects.toBe(failure);
    expect(await store.derive(derive)).toBe((await store.logIndex()).rowCount);
  });
});
