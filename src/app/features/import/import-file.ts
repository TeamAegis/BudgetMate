import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  LucideCopy,
  LucideCircleCheck,
  LucideTriangleAlert,
  LucideSquare,
  LucideSquareCheck,
  LucideInfo,
} from '@lucide/angular';
import {
  listAccounts,
  pickImportFile,
  importReadHeaders,
  importPreview,
  importCommit,
  getSettings,
  isTauri,
  toUserMessage,
} from '../../core/bridge';
import { LockService } from '../../core/lock/lock.service';
import type {
  Account,
  ColumnMappingInput,
  ImportFormat,
  ImportHeaders,
  ImportPreviewData,
  Iso4217,
  PreviewRow,
  ImportResultData,
} from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { FormField } from '../../shared/ui/form-field/form-field';
import { SegmentedToggle, type SegmentOption } from '../../shared/ui/segmented-toggle/segmented-toggle';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

/** Sentinel for "no source column" in an optional mapping field's SelectField. */
const NOT_MAPPED = -1;

/** UI phase of the import wizard. Each maps to one of the five required screen states (design.md).
 *  OFX/QFX skip 'mapping' entirely (the file already names its own fields) - `chooseFile()` goes
 *  straight from 'idle' to 'reviewing' for those two formats. */
type Phase = 'idle' | 'mapping' | 'reviewing' | 'committing' | 'done' | 'error';

/** Format choices for the idle-step segmented toggle. */
const FORMAT_OPTIONS: SegmentOption[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'ofx', label: 'OFX' },
  { value: 'qfx', label: 'QFX' },
];

/**
 * Import Wizard (FR-2.2/2.3/2.4, screens.md §4.5): pick an account and a local CSV file, map its
 * columns to date/amount/payee/note/reference, preview the parsed rows (with a suggested category
 * from the active rules and a possible-duplicate flag from dedup), then explicitly confirm before
 * anything is saved. Nothing auto-commits (design.md "Flows that must never auto-commit") -
 * malformed rows are reported, never silently dropped, and the ACID batch insert only happens on
 * `importCommit`. All parsing/rule/dedup/money logic lives in Rust; this component only picks the
 * file, marshals the column mapping, and formats/presents the result.
 */
@Component({
  selector: 'app-import-file',
  imports: [
    MoneyPipe,
    LucideCopy,
    LucideCircleCheck,
    LucideTriangleAlert,
    LucideSquare,
    LucideSquareCheck,
    LucideInfo,
    Button,
    Banner,
    EmptyState,
    FormField,
    SegmentedToggle,
    SelectField,
    Spinner,
    Skeleton,
  ],
  // MoneyPipe is also provided here so `rowToggleLabel()` can reuse its (presentation-only)
  // formatting to build a per-row accessible name (design#3) without duplicating format logic.
  providers: [MoneyPipe],
  templateUrl: './import-file.html',
  styleUrl: './import-file.scss',
})
export class ImportFile implements OnInit {
  private readonly router = inject(Router);
  private readonly lockService = inject(LockService);
  private readonly money = inject(MoneyPipe);

  protected readonly phase = signal<Phase>('idle');
  protected readonly error = signal<string | null>(null);
  /** In-flight indicator for a step that stays within the current phase (picking/reading a file,
   *  running the preview) - distinct from the dedicated `committing` phase. */
  protected readonly busy = signal(false);

  protected readonly loadingAccounts = signal(true);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly accountId = signal<number | null>(null);
  /** The reporting/base currency (`getSettings().baseCurrency`) - used only to warn (never to
   *  convert) when the chosen account's currency differs (finance#1 / code#5). */
  protected readonly baseCurrency = signal<Iso4217 | null>(null);

  /** Chosen bank-file format (docs/adr/0011). Only CSV has a mapping step - OFX/QFX are
   *  self-describing, so `chooseFile()` goes straight from picking the file to `preview()`. */
  protected readonly format = signal<ImportFormat>('csv');
  protected readonly formatOptions: SegmentOption[] = FORMAT_OPTIONS;

  protected readonly path = signal<string | null>(null);
  protected readonly headers = signal<ImportHeaders | null>(null);

  protected readonly dateCol = signal<number | null>(null);
  protected readonly amountCol = signal<number | null>(null);
  protected readonly payeeCol = signal<number>(NOT_MAPPED);
  protected readonly noteCol = signal<number>(NOT_MAPPED);
  protected readonly refCol = signal<number>(NOT_MAPPED);

  protected readonly previewData = signal<ImportPreviewData | null>(null);
  /** 0-based data-row indices the user has chosen NOT to import. Possible duplicates default to
   *  skipped (the safer default); the user can toggle any row back in (or out). */
  protected readonly skipRows = signal<Set<number>>(new Set());
  protected readonly result = signal<ImportResultData | null>(null);

  protected readonly accountOptions = computed<SelectOption[]>(() =>
    // "Cash · MUR" - the same account formatting the rest of the app uses.
    this.accounts().map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
  );

  /**
   * Imported amounts are stored at a fixed fx rate of 1 (docs/adr/0010 - a v1 limitation, no fx
   * input in this ticket). When the chosen account's currency differs from the base reporting
   * currency, warn plainly rather than silently importing unconverted amounts (finance#1 / code#5).
   */
  protected readonly fxWarning = computed(() => {
    const base = this.baseCurrency();
    const account = this.accounts().find((a) => a.id === this.accountId());
    if (!base || !account || account.currency === base) return null;
    return `This account is in ${account.currency} but your reports add up in ${base}. Imported amounts will not be converted for reporting yet.`;
  });

  protected readonly filename = computed(() => {
    const p = this.path();
    if (!p) return null;
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  });

  protected readonly columnOptions = computed<SelectOption[]>(() =>
    (this.headers()?.headers ?? []).map((name, i) => ({
      value: i,
      label: name.trim() || `Column ${i + 1}`,
    })),
  );
  protected readonly optionalColumnOptions = computed<SelectOption[]>(() => [
    { value: NOT_MAPPED, label: 'Not in this file' },
    ...this.columnOptions(),
  ]);

  /** CSV needs a valid mapping before previewing; OFX/QFX only need an account (the file already
   *  names its own fields, so there is no mapping step to gate on). */
  protected readonly canPreview = computed(() => {
    if (this.accountId() === null) return false;
    if (this.format() !== 'csv') return true;
    return this.dateCol() !== null && this.amountCol() !== null;
  });

  /** Idle-step copy that names the chosen format (design.md - plain language over jargon). "OFX"
   *  takes "an" (vowel sound); "CSV"/"QFX" take "a". */
  protected readonly chooseFileCta = computed(
    () => `Choose ${this.format() === 'ofx' ? 'an' : 'a'} ${this.format().toUpperCase()} file`,
  );
  protected readonly chooseFileMessage = computed(() => {
    switch (this.format()) {
      case 'ofx':
        return 'Import an OFX bank statement. Nothing is saved until you review and confirm the transactions.';
      case 'qfx':
        return 'Import a QFX bank statement. Nothing is saved until you review and confirm the transactions.';
      default:
        return 'Import a CSV bank statement. Nothing is saved until you review and confirm the transactions.';
    }
  });
  /** The mapping step only exists for CSV - say so only there; an OFX/QFX file needs no column
   *  mapping (design.md "Plain-language glossary" - name only what the user will actually see). For
   *  OFX/QFX also set expectations up front that a different-currency transaction will not be
   *  imported (design review of issue #13 - heads-up before the user picks a file). */
  protected readonly chooseFileNote = computed(() => {
    if (this.format() === 'csv') {
      return 'The file stays on your device - nothing is uploaded. You will map its columns and confirm every row before anything is saved.';
    }
    return 'The file stays on your device - nothing is uploaded. Any transaction in a different currency than this account will not be imported. You will confirm every row before anything is saved.';
  });

  protected readonly toImportCount = computed(() => {
    const data = this.previewData();
    if (!data) return 0;
    return data.rows.filter((r) => !this.isSkipped(r.row)).length;
  });

  /** Plain-language summary for the reviewing banner: how many will import, how many look like
   *  duplicates, how many rows could not be read at all, and how many were excluded solely for a
   *  currency mismatch. Three distinct clauses that must never conflate (finance#7): "skipped"/
   *  "left out" is reserved for rows the USER excludes; malformed rows always read "could not be
   *  read"; a currency mismatch reads "in another currency (not imported)" - it was read fine, it
   *  was deliberately excluded for money-safety, and it is not an error. */
  protected readonly summaryText = computed(() => {
    const data = this.previewData();
    if (!data) return '';
    const n = this.toImportCount();
    const parts = [`${n} transaction${n === 1 ? '' : 's'} to import`];
    if (data.duplicateCount > 0) {
      parts.push(
        `${data.duplicateCount} possible duplicate${data.duplicateCount === 1 ? '' : 's'}`,
      );
    }
    if (data.errors.length > 0) {
      parts.push(
        `${data.errors.length} row${data.errors.length === 1 ? '' : 's'} could not be read`,
      );
    }
    if (data.currencyMismatches.length > 0) {
      parts.push(
        `${data.currencyMismatches.length} in another currency (not imported)`,
      );
    }
    return parts.join(', ');
  });

  /** True when the file parsed to zero importable rows (header-only, or every row malformed) - the
   *  reviewing step shows a teaching state instead of an empty list under a "0 to import" banner. */
  protected readonly noImportableRows = computed(() => (this.previewData()?.rows.length ?? 0) === 0);

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loadingAccounts.set(false);
      return;
    }
    try {
      const [accts, settings] = await Promise.all([listAccounts(false), getSettings()]);
      this.accounts.set(accts);
      this.baseCurrency.set(settings.baseCurrency);
      if (accts.length > 0) this.accountId.set(accts[0].id);
    } catch (e) {
      this.phase.set('error');
      this.error.set(toUserMessage(e));
    } finally {
      this.loadingAccounts.set(false);
    }
  }

  protected setAccountId(v: number | string): void {
    this.accountId.set(Number(v));
  }
  protected setFormat(v: string): void {
    this.format.set(v as ImportFormat);
  }
  protected setDateCol(v: number | string): void {
    this.dateCol.set(Number(v));
  }
  protected setAmountCol(v: number | string): void {
    this.amountCol.set(Number(v));
  }
  protected setPayeeCol(v: number | string): void {
    this.payeeCol.set(Number(v));
  }
  protected setNoteCol(v: number | string): void {
    this.noteCol.set(Number(v));
  }
  protected setRefCol(v: number | string): void {
    this.refCol.set(Number(v));
  }

  protected isSkipped(row: number): boolean {
    return this.skipRows().has(row);
  }

  protected toggleSkip(row: number): void {
    this.skipRows.update((set) => {
      const next = new Set(set);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  }

  /** Per-row accessible name for the keep/skip control - payee + date + amount, so screen reader
   *  and switch users can tell rows apart (design#3; the control's own label used to read "Import"
   *  for every row). `aria-pressed` (set in the template) already conveys the keep/skip state. */
  protected rowToggleLabel(row: PreviewRow): string {
    const payee = row.payee?.trim() || 'this transaction';
    const amount = this.money.transform({ amountMinor: row.amountMinor, currency: row.currency }, true);
    return `${payee}, ${row.postedDate}, ${amount}`;
  }

  /** Pick a local CSV file and read its header row for the mapping step. */
  protected async chooseFile(): Promise<void> {
    if (!isTauri()) {
      this.phase.set('error');
      this.error.set('Run the app (npm run tauri dev) to import a bank statement.');
      return;
    }
    this.error.set(null);
    let picked: string | null;
    // The native file picker backgrounds the WebView; flag it as a trusted excursion so the
    // visibility listener doesn't lock the vault mid-pick (mirrors the OCR scan flow).
    this.lockService.beginTrustedExcursion();
    try {
      picked = await pickImportFile(this.format());
    } catch (e) {
      this.phase.set('error');
      this.error.set(toUserMessage(e));
      return;
    } finally {
      this.lockService.endTrustedExcursion();
    }
    if (!picked) return; // cancelled - stay on the current phase

    this.path.set(picked);

    if (this.format() !== 'csv') {
      // OFX/QFX are self-describing - no column-mapping step. Parse straight to reviewing.
      await this.preview();
      return;
    }

    this.busy.set(true);
    try {
      const h = await importReadHeaders(picked, 'csv');
      this.headers.set(h);
      this.dateCol.set(null);
      this.amountCol.set(null);
      this.payeeCol.set(NOT_MAPPED);
      this.noteCol.set(NOT_MAPPED);
      this.refCol.set(NOT_MAPPED);
      this.phase.set('mapping');
    } catch (e) {
      this.phase.set('error');
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** The column mapping as the bridge/Rust shape - `NOT_MAPPED` (-1) becomes `null`. */
  private mappingInput(): ColumnMappingInput {
    const optional = (v: number) => (v === NOT_MAPPED ? null : v);
    return {
      date: this.dateCol() ?? 0,
      amount: this.amountCol() ?? 0,
      payee: optional(this.payeeCol()),
      note: optional(this.noteCol()),
      sourceRef: optional(this.refCol()),
    };
  }

  /** Parse the file against the chosen mapping and show the reviewing step. Writes nothing. */
  protected async preview(): Promise<void> {
    const accountId = this.accountId();
    const path = this.path();
    if (!this.canPreview() || accountId === null || !path) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const data = await importPreview({
        path,
        format: this.format(),
        accountId,
        mapping: this.format() === 'csv' ? this.mappingInput() : undefined,
      });
      this.previewData.set(data);
      this.skipRows.set(new Set(data.rows.filter((r) => r.duplicate).map((r) => r.row)));
      this.phase.set('reviewing');
    } catch (e) {
      this.phase.set('error');
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Commit the reviewed rows (minus any the user skipped) as one ACID batch. */
  protected async commit(): Promise<void> {
    const accountId = this.accountId();
    const path = this.path();
    if (accountId === null || !path) return;
    this.phase.set('committing');
    this.error.set(null);
    try {
      const result = await importCommit({
        path,
        format: this.format(),
        accountId,
        mapping: this.format() === 'csv' ? this.mappingInput() : undefined,
        skipRows: [...this.skipRows()],
      });
      this.result.set(result);
      this.phase.set('done');
    } catch (e) {
      this.phase.set('error');
      this.error.set(toUserMessage(e));
    }
  }

  /** Discard the current file/mapping/preview and start over. */
  protected startOver(): void {
    this.phase.set('idle');
    this.error.set(null);
    this.path.set(null);
    this.headers.set(null);
    this.previewData.set(null);
    this.result.set(null);
    this.skipRows.set(new Set());
    this.dateCol.set(null);
    this.amountCol.set(null);
    this.payeeCol.set(NOT_MAPPED);
    this.noteCol.set(NOT_MAPPED);
    this.refCol.set(NOT_MAPPED);
  }

  /** Recover from an error back to the furthest step whose data is still valid. */
  protected retry(): void {
    this.error.set(null);
    if (this.previewData()) this.phase.set('reviewing');
    else if (this.headers()) this.phase.set('mapping');
    else this.phase.set('idle');
  }

  protected goToAccounts(): void {
    void this.router.navigate(['/settings/accounts']);
  }

  protected finish(): void {
    void this.router.navigate(['/expenses']);
  }
}
