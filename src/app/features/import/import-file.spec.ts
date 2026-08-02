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

describe('ImportFile - format selection (docs/adr/0011-ofx-import-wiring.md)', () => {
  it('defaults to CSV', () => {
    const c = createComponent();
    expect(c.format()).toBe('csv');
  });

  it('setFormat drives the format signal - what the picker and the idle-step copy read from', () => {
    const c = createComponent();
    c.setFormat('ofx');
    expect(c.format()).toBe('ofx');
    c.setFormat('qfx');
    expect(c.format()).toBe('qfx');
  });

  it('CSV still requires a date and amount column before previewing', () => {
    const c = createComponent();
    c.accountId.set(1);
    expect(c.canPreview()).toBe(false, 'no date/amount column chosen yet');
    c.setDateCol(0);
    c.setAmountCol(1);
    expect(c.canPreview()).toBe(true);
  });

  it('OFX/QFX need only an account - no mapping step, so no column requirement', () => {
    const c = createComponent();
    c.setFormat('ofx');
    expect(c.canPreview()).toBe(false, 'still needs an account');
    c.accountId.set(1);
    expect(c.canPreview()).toBe(true, 'dateCol/amountCol are never set for a self-describing file');

    c.setFormat('qfx');
    expect(c.canPreview()).toBe(true);
  });

  it('idle-step copy names the chosen format and only mentions column mapping for CSV', () => {
    const c = createComponent();
    expect(c.chooseFileCta()).toBe('Choose a CSV file');
    expect(c.chooseFileNote()).toContain('map its columns');

    c.setFormat('ofx');
    expect(c.chooseFileCta()).toBe('Choose an OFX file');
    expect(c.chooseFileMessage()).toContain('OFX');
    expect(c.chooseFileNote()).not.toContain('map its columns');

    c.setFormat('qfx');
    expect(c.chooseFileCta()).toBe('Choose a QFX file');
    expect(c.chooseFileMessage()).toContain('QFX');
    expect(c.chooseFileNote()).not.toContain('map its columns');
  });

  it('OFX/QFX idle-step note gives a heads-up that a different-currency row will not be imported', () => {
    const c = createComponent();
    // CSV never mixes currencies (the row always takes the account's currency), so the CSV note
    // says nothing about currency exclusion.
    expect(c.chooseFileNote()).not.toContain('currency');

    c.setFormat('ofx');
    expect(c.chooseFileNote()).toContain('different currency');
    expect(c.chooseFileNote()).toContain('will not be imported');

    c.setFormat('qfx');
    expect(c.chooseFileNote()).toContain('different currency');
  });

  it('reaches the reviewing step for OFX/QFX without ever populating headers (no mapping step)', () => {
    // Mirrors what `preview()` does on success (headers/mapping are CSV-only, so an OFX/QFX run
    // never touches `headers`) - bridge calls cannot be spied on here (see the file header note),
    // so this simulates the resulting state directly.
    const c = createComponent();
    c.setFormat('ofx');
    c.previewData.set({
      rows: [],
      errors: [],
      currencyMismatches: [],
      duplicateCount: 0,
      currency: 'MUR',
    });
    c.phase.set('reviewing');

    expect(c.phase()).toBe('reviewing');
    expect(c.headers()).toBeNull();

    // retry() from an error must still route back to 'reviewing' (never 'mapping') for OFX/QFX,
    // exactly as it does for CSV once a preview exists.
    c.phase.set('error');
    c.retry();
    expect(c.phase()).toBe('reviewing');
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
        suggestedCategoryReason: "matched rule: merchant contains 'winners'",
        duplicate: false,
        duplicateReason: null,
      },
      {
        row: 1,
        postedDate: '2026-06-02',
        amountMinor: -1000,
        currency: 'MUR',
        payee: 'Cafe',
        note: null,
        sourceRef: null,
        suggestedCategory: 'Uncategorized',
        suggestedCategoryReason: null,
        duplicate: true,
        duplicateReason: 'same amount as a transaction on 2026-05-31',
      },
    ],
    errors: [{ row: 2, message: "unrecognised date 'oops'" }],
    currencyMismatches: [],
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

  it('summarises duplicates and malformed rows in plain language, never conflating the two', () => {
    const c = createComponent();
    c.previewData.set(preview);
    c.skipRows.set(new Set([1]));

    // "could not be read" (malformed) is never worded as "skipped" - that word is reserved for
    // rows the user chose to exclude (finance#7).
    expect(c.summaryText()).toBe(
      '1 transaction to import, 1 possible duplicate, 1 row could not be read',
    );
  });

  it('summarises a currency mismatch in its own clause, distinct from malformed and duplicates', () => {
    const c = createComponent();
    c.previewData.set({
      ...preview,
      errors: [],
      currencyMismatches: [{ row: 3, message: 'This transaction is in USD; this account is in MUR.' }],
    });
    c.skipRows.set(new Set([1]));

    expect(c.summaryText()).toBe(
      '1 transaction to import, 1 possible duplicate, 1 in another currency (not imported)',
    );
  });

  it('has no importable rows only when the parsed rows array is empty', () => {
    const c = createComponent();
    c.previewData.set(preview);
    expect(c.noImportableRows()).toBe(false);

    c.previewData.set({
      rows: [],
      errors: preview.errors,
      currencyMismatches: [],
      duplicateCount: 0,
      currency: 'MUR',
    });
    expect(c.noImportableRows()).toBe(true);
  });

  it('builds a per-row accessible name from payee, date, and amount', () => {
    const c = createComponent();
    const label = c.rowToggleLabel(preview.rows[0]);
    expect(label).toContain('Winners');
    expect(label).toContain('2026-06-01');
  });

  it('falls back to a generic phrase when a row has no payee', () => {
    const c = createComponent();
    const label = c.rowToggleLabel({ ...preview.rows[0], payee: null });
    expect(label).toContain('this transaction');
  });
});

describe('ImportFile - foreign-currency warning (finance#1 / code#5)', () => {
  const accounts: Account[] = [
    { id: 1, name: 'USD Card', accountType: 'card', currency: 'USD', openingBalanceMinor: 0, archived: false, balanceMinor: 0 },
    { id: 2, name: 'Cash', accountType: 'cash', currency: 'MUR', openingBalanceMinor: 0, archived: false, balanceMinor: 0 },
  ];

  it('warns when the chosen account currency differs from the base reporting currency', () => {
    const c = createComponent();
    c.accounts.set(accounts);
    c.baseCurrency.set('MUR');
    c.accountId.set(1);

    expect(c.fxWarning()).toContain('USD');
    expect(c.fxWarning()).toContain('MUR');
    expect(c.fxWarning()).toContain('not be converted');
  });

  it('shows no warning when the account currency matches the base currency', () => {
    const c = createComponent();
    c.accounts.set(accounts);
    c.baseCurrency.set('MUR');
    c.accountId.set(2);

    expect(c.fxWarning()).toBeNull();
  });

  it('shows no warning before an account or the base currency is known', () => {
    const c = createComponent();
    c.accounts.set(accounts);

    expect(c.fxWarning()).toBeNull();
  });
});

describe('ImportFile - done summary (currencySkipped kept separate from malformed)', () => {
  it('holds inserted/skipped/malformed/currencySkipped independently', () => {
    const c = createComponent();
    c.result.set({ inserted: 2, skipped: 1, malformed: 1, currencySkipped: 3 });

    expect(c.result().inserted).toBe(2);
    expect(c.result().skipped).toBe(1);
    expect(c.result().malformed).toBe(1);
    expect(c.result().currencySkipped).toBe(3);
  });
});

describe('ImportFile - states', () => {
  it('starts idle and clears every step on startOver', () => {
    const c = createComponent();
    c.phase.set('reviewing');
    c.path.set('/tmp/statement.csv');
    c.headers.set({ headers: ['Date'], sampleRows: [] });
    c.previewData.set({
      rows: [],
      errors: [],
      currencyMismatches: [],
      duplicateCount: 0,
      currency: 'MUR',
    });
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
    c.previewData.set({
      rows: [],
      errors: [],
      currencyMismatches: [],
      duplicateCount: 0,
      currency: 'MUR',
    });
    c.retry();
    expect(c.phase()).toBe('reviewing');
  });

  it('an account list of one seeds the account picker for the idle/populated state', () => {
    const c = createComponent();
    const accounts: Account[] = [
      { id: 7, name: 'Cash', accountType: 'cash', currency: 'MUR', openingBalanceMinor: 0, archived: false, balanceMinor: 0 },
    ];
    c.accounts.set(accounts);

    // "Cash · MUR" - the app-wide account label format, not parenthesised.
    expect(c.accountOptions()).toEqual([{ value: 7, label: 'Cash · MUR' }]);
  });
});
