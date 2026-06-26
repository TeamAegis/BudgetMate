import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideArchive } from '@lucide/angular';
import {
  listAccounts,
  createAccount,
  updateAccount,
  archiveAccount,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { Account, AccountKind } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { Button } from '../../shared/ui/button/button';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const KINDS: AccountKind[] = ['cash', 'bank', 'card', 'wallet', 'other'];

/**
 * Full-screen Add/Edit Account page. Replaces the former centred modal: a pushed route
 * (`settings/accounts/new`, `settings/accounts/:id/edit`) with Save in the app header (so the
 * Android soft keyboard can never hide it) and the back arrow as Cancel. Smart component - reads the
 * account through the bridge and renders with shared/ui. The opening balance enters the ledger via
 * transactions, so it is never edited here: create starts at 0 and edit preserves the stored value.
 */
@Component({
  selector: 'app-account-form',
  imports: [
    ReactiveFormsModule,
    LucideArchive,
    Button,
    Banner,
    Spinner,
    FormField,
    ConfirmDialog,
    SelectField,
  ],
  templateUrl: './account-form.html',
  styleUrl: './account-form.scss',
})
export class AccountForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);

  /** Entity handed over via router state at construction (fast path; edit falls back to the list). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedAccount =
    (this.nav?.extras.state?.['account'] as Account | undefined) ?? null;

  /** Edit id from the route (`settings/accounts/:id/edit`); null on the add route. */
  protected readonly editingId = signal<number | null>(
    this.route.snapshot.paramMap.has('id')
      ? Number(this.route.snapshot.paramMap.get('id'))
      : null,
  );
  protected readonly editing = computed(() => this.editingId() !== null);

  /** Themed-dropdown options for the account type (native <select> can't be styled in the WebView). */
  protected readonly kindOptions: SelectOption[] = KINDS.map((k) => ({ value: k, label: k }));

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingArchive = signal(false);

  /** The loaded account when editing; needed to preserve openingBalanceMinor on update. */
  private readonly account = signal<Account | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    accountType: ['cash' as AccountKind, Validators.required],
    currency: ['MUR', [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]],
  });

  constructor() {
    // Publish Save into the global header; the back arrow is Cancel (App owns it). Re-published on
    // busy() change so the header button shows the in-flight state. Cleared on teardown.
    effect(() => {
      this.headerAction.set({ label: 'Save', loading: this.busy(), run: () => void this.save() });
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  // -- Inline validation messages (shown only when invalid AND touched) ---------------

  protected nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter a name.' : 'Name is too long (60 characters max).';
  }

  protected currencyError(): string | null {
    const c = this.form.controls.currency;
    if (!c.invalid || !c.touched) return null;
    return 'Use a 3-letter currency code, e.g. MUR.';
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage accounts.');
      return;
    }
    try {
      const id = this.editingId();
      if (id !== null) {
        // Edit: prefer the row handed over via router state, else look it up in the list.
        const acct = this.passedAccount ?? (await listAccounts(false)).find((a) => a.id === id) ?? null;
        if (!acct) {
          this.error.set('That account could not be found.');
        } else {
          this.account.set(acct);
          this.form.reset({
            name: acct.name,
            accountType: acct.accountType,
            currency: acct.currency,
          });
        }
      }
      // Create needs no reference data; the currency default stays 'MUR'.
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Bind the SelectField's emitted value back onto the form control. */
  protected setKind(v: number | string): void {
    this.form.controls.accountType.setValue(v as AccountKind);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, accountType, currency } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      const id = this.editingId();
      if (id === null) {
        // opening balance enters the ledger via transactions (FR-1.x); accounts start at 0.
        await createAccount({ name, accountType, currency, openingBalanceMinor: 0 });
      } else {
        const existing = this.account();
        await updateAccount({
          id,
          name,
          accountType,
          currency,
          openingBalanceMinor: existing?.openingBalanceMinor ?? 0,
        });
      }
      await this.router.navigate(['/settings/accounts']);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async archiveConfirmed(): Promise<void> {
    const id = this.editingId();
    if (id === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await archiveAccount(id);
      await this.router.navigate(['/settings/accounts']);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingArchive.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  /** Confirmation message naming the account being archived. */
  protected archiveMessage(): string {
    const name = this.account()?.name ?? this.form.controls.name.value;
    return `Archive "${name}"? It will be hidden from pickers but not deleted.`;
  }
}
