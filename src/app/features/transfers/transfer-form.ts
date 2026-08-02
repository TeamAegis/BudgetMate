import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { listAccounts, createTransfer, toUserMessage, isTauri } from '../../core/bridge';
import type { Account } from '../../core/models';
import { readOrigin, returnTo } from '../../core/navigation/origin';
import { CurrencyService } from '../../core/money/currency.service';
import { maxFractionDigits } from '../../core/money/amount-validators';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Full-screen Move money page: an account-to-account transfer. A pushed route (`transfers/new`) with
 * Save in the fixed bottom action bar and the back arrow as Cancel - the standard form-page pattern
 * (ADR 0002/0003). There is no edit route: a transfer is a linked pair of ledger rows, so correcting
 * one means deleting the legs rather than editing half of it.
 *
 * v1 is SAME-CURRENCY only. Rather than let the user fill the form and then fail on save, the
 * destination list only offers accounts that share the source's currency, and a plain-language hint
 * explains why when that leaves nothing to pick. Rust re-validates regardless - it owns the rule.
 *
 * The amount is entered as a major-unit string ("5000.00") and parsed to minor units in Rust. No
 * money math in TS.
 */
@Component({
  selector: 'app-transfer-form',
  imports: [ReactiveFormsModule, Banner, Spinner, FormField, FormActions, SelectField],
  templateUrl: './transfer-form.html',
  styleUrl: './transfer-form.scss',
})
export class TransferForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly currencyService = inject(CurrencyService);

  /** Where to go back to after saving (the screen that sent us here), else Accounts. */
  private readonly origin = readOrigin(this.router);

  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * The two account choices live in SIGNALS rather than in the form. The amount's precision
   * validator depends on the source account's currency, so keeping the accounts in the form would
   * make the form's own initializer depend on a computed that reads the form - a circular type
   * (TS7022) and a real runtime cycle. The selects are driven imperatively either way.
   */
  protected readonly fromId = signal(0);
  protected readonly toId = signal(0);

  protected readonly form = this.fb.nonNullable.group({
    amount: [
      '',
      [
        Validators.required,
        Validators.pattern(DECIMAL),
        maxFractionDigits(() => this.currencyService.fractionDigits(this.currency())),
      ],
    ],
    postedDate: [todayIso(), [Validators.required]],
    note: [''],
  });

  /** Only non-archived accounts can take part in a new transfer. */
  private readonly active = computed(() => this.accounts().filter((a) => !a.archived));

  protected readonly fromOptions = computed<SelectOption[]>(() =>
    this.active().map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
  );

  private readonly fromAccount = computed<Account | null>(
    () => this.active().find((a) => a.id === this.fromId()) ?? null,
  );

  /**
   * The destination list: every OTHER account sharing the source's currency. Filtering here (rather
   * than validating after the fact) means the same-currency rule is visible in the UI instead of
   * arriving as a save-time rejection.
   */
  protected readonly toOptions = computed<SelectOption[]>(() => {
    const from = this.fromAccount();
    if (!from) return [];
    return this.active()
      .filter((a) => a.id !== from.id && a.currency === from.currency)
      .map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }));
  });

  /** Plain-language explanation when the source has no eligible partner account. */
  protected readonly noDestinationHint = computed<string | null>(() => {
    const from = this.fromAccount();
    if (!from || this.toOptions().length > 0) return null;
    if (this.active().length < 2) {
      return 'You need a second account to move money into. Add one from Accounts first.';
    }
    return `None of your other accounts are in ${from.currency}. Moving money between two different currencies is not supported yet.`;
  });

  protected readonly currency = computed(() => this.fromAccount()?.currency ?? '');

  /**
   * Deliberately a METHOD, not a `computed()`: it depends on `form.valid`, which is not a signal, so
   * a computed would cache the first answer and never notice the user typing an amount - leaving
   * Save stuck disabled. A method is re-evaluated each change-detection pass.
   */
  protected canSave(): boolean {
    return (
      !this.saving() &&
      this.fromId() > 0 &&
      this.toId() > 0 &&
      this.toOptions().length > 0 &&
      this.form.valid
    );
  }

  protected readonly amountError = computed(() => {
    const c = this.form.controls.amount;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Enter an amount.';
    if (c.hasError('pattern')) return 'Enter a plain number, like 5000.00';
    if (c.hasError('maxFractionDigits')) {
      const d = this.currencyService.fractionDigits(this.currency());
      return d === 0 ? 'Use a whole number.' : `Use at most ${d} decimal places.`;
    }
    return 'Enter a valid amount.';
  });

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to move money between accounts.');
      return;
    }
    try {
      const accounts = await listAccounts();
      this.accounts.set(accounts);
      const first = accounts.filter((a) => !a.archived)[0];
      if (first) {
        this.fromId.set(first.id);
        // Preselect the only eligible destination, so the common two-account case is one tap.
        const only = this.toOptions();
        if (only.length === 1) this.toId.set(Number(only[0]!.value));
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Changing the source can invalidate the chosen destination (different currency) - clear it. */
  protected onFromChange(value: number | string): void {
    this.fromId.set(Number(value));
    // Changing the source can invalidate the destination (now a different currency, or the same
    // account) - drop it rather than silently submitting a stale pair.
    if (!this.toOptions().some((o) => Number(o.value) === this.toId())) this.toId.set(0);
  }

  protected onToChange(value: number | string): void {
    this.toId.set(Number(value));
  }

  protected async save(): Promise<void> {
    this.form.markAllAsTouched();
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    try {
      await createTransfer({
        fromAccountId: this.fromId(),
        toAccountId: this.toId(),
        amount: v.amount,
        postedDate: v.postedDate,
        note: v.note.trim() || null,
      });
      await this.router.navigate([returnTo(this.origin, '/settings/accounts')]);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}

/** Today as `yyyy-mm-dd`, for the date field's default. */
function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
