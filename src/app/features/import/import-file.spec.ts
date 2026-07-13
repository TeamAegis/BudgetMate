import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ImportFile } from './import-file';
import type { Account, ImportHeaders, ImportPreviewData } from '../../core/models';

/**
 * Bridge calls (`listAccounts`, `pickImportFile`, `importReadHeaders`, `importPreview`,
 * `importCommit`) cannot be mocked here: they are named exports of `core/bridge`, and Jasmine's
 * `spyOn` cannot redefine a property on an ES module namespace object (see import.spec.ts /
 * transaction-form.spec.ts for the same constraint). Constructing the component (without
 * `detectChanges()`) never runs `ngOnInit`, so each test seeds the relevant signals directly and
 * drives the protected methods the way the template would - exercising the real validation/
 * mapping/toggle logic without touching production code to make it testable.
 *
 * `createComponent` deliberately returns `any` so the tests can reach the protected `dateCol` /
 * `amountCol` / `previewData` / `skipRows` / etc. members from outside the class.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function createComponent(): any {
  TestBed.configureTestingModule({
    imports: [ImportFile],
    providers: [provideRouter([])],
  });
  return TestBed.createComponent(ImportFile).componentInstance;
}

describe('ImportFile - mapping validation', () => {
  const headers: ImportHeaders = {
    headers: ['Date', 'Description', 'Amount'],
    sampleRows: [['2026-06-01', 'Winners', '-450.00']],
  };

  it('requires an account, a date column, and an amount column before previewing', () => {
    const c = createComponent();
    c.headers.set(headers);

    expect(c.canPreview()).toBe(false);

    c.accountId.set(1);
    expect(c.canPreview()).toBe(false);

    c.setDateCol(0);
    expect(c.canPreview()).toBe(false);

    c.setAmountCol(2);
    expect(c.canPreview()).toBe(true);
  });

  it('builds the column mapping, treating "Not in this file" (-1) as omitted', () => {
    const c = createComponent();
    c.setDateCol(0);
    c.setAmountCol(2);
    c.setPayeeCol(1);
    // noteCol/refCol left at their NOT_MAPPED default.

    expect(c['mappingInput']()).toEqual({
      date: 0,
      amount: 2,
      payee: 1,
      note: null,
      sourceRef: null,
    });
  });

  it('derives select options from the header row, falling back to a positional label for a blank header', () => {
    const c = createComponent();
    c.headers.set({ headers: ['Date', '', 'Amount'], sampleRows: [] });

    expect(c.columnOptions()).toEqual([
      { value: 0, label: 'Date' },
      { value: 1, label: 'Column 2' },
      { value: 2, label: 'Amount' },
    ]);
    expect(c.optionalColumnOptions()[0]).toEqual({ value: -1, label: 'Not in this file' });
  });
});

describe('ImportFile - duplicate keep/skip toggling + summary', () => {
  const preview: ImportPreviewData = {
    rows: [
      {
        row: 0,
        postedDate: '2026-06-01',
        amountMinor: -45000,
        currency: 'MUR',
        payee: 'Winners',
        note: null,
        sourceRef: null,
        suggestedCategory: 'Groceries',
        duplicate: false,
      },
      {
        row: 1,
        postedDate: '2026-06-02',
        amountMinor: -1000,
        currency: 'MUR',
        payee: 'Cafe',
        note: null,
        sourceRef: null,
        suggestedCategory: null,
        duplicate: true,
      },
    ],
    errors: [{ row: 2, message: "unrecognised date 'oops'" }],
    duplicateCount: 1,
    currency: 'MUR',
  };

  it('defaults possible duplicates to skipped, counting only the rest as to-import', () => {
    const c = createComponent();
    c.previewData.set(preview);
    c.skipRows.set(new Set([1]));

    expect(c.isSkipped(0)).toBe(false);
    expect(c.isSkipped(1)).toBe(true);
    expect(c.toImportCount()).toBe(1);
  });

  it('toggling a duplicate back in increases the to-import count', () => {
    const c = createComponent();
    c.previewData.set(preview);
    c.skipRows.set(new Set([1]));

    c.toggleSkip(1);

    expect(c.isSkipped(1)).toBe(false);
    expect(c.toImportCount()).toBe(2);
  });

  it('toggling a row back out (skipping a non-duplicate) decreases the to-import count', () => {
    const c = createComponent();
    c.previewData.set(preview);
    c.skipRows.set(new Set([1]));

    c.toggleSkip(0);

    expect(c.isSkipped(0)).toBe(true);
    expect(c.toImportCount()).toBe(0);
  });

  it('summarises duplicates and malformed rows in plain language', () => {
    const c = createComponent();
    c.previewData.set(preview);
    c.skipRows.set(new Set([1]));

    expect(c.summaryText()).toBe(
      '1 transaction to import, 1 possible duplicate, 1 row skipped for errors',
    );
  });
});

describe('ImportFile - states', () => {
  it('starts idle and clears every step on startOver', () => {
    const c = createComponent();
    c.phase.set('reviewing');
    c.path.set('/tmp/statement.csv');
    c.headers.set({ headers: ['Date'], sampleRows: [] });
    c.previewData.set({ rows: [], errors: [], duplicateCount: 0, currency: 'MUR' });
    c.skipRows.set(new Set([1]));

    c.startOver();

    expect(c.phase()).toBe('idle');
    expect(c.path()).toBeNull();
    expect(c.headers()).toBeNull();
    expect(c.previewData()).toBeNull();
    expect(c.skipRows().size).toBe(0);
  });

  it('retry() returns to the furthest step whose data is still valid', () => {
    const c = createComponent();

    // No headers/preview yet -> idle.
    c.retry();
    expect(c.phase()).toBe('idle');

    // Headers but no preview -> mapping.
    c.headers.set({ headers: ['Date'], sampleRows: [] });
    c.retry();
    expect(c.phase()).toBe('mapping');

    // Preview present -> reviewing.
    c.previewData.set({ rows: [], errors: [], duplicateCount: 0, currency: 'MUR' });
    c.retry();
    expect(c.phase()).toBe('reviewing');
  });

  it('an account list of one seeds the account picker for the idle/populated state', () => {
    const c = createComponent();
    const accounts: Account[] = [
      { id: 7, name: 'Cash', accountType: 'cash', currency: 'MUR', openingBalanceMinor: 0, archived: false },
    ];
    c.accounts.set(accounts);

    expect(c.accountOptions()).toEqual([{ value: 7, label: 'Cash (MUR)' }]);
  });
});
