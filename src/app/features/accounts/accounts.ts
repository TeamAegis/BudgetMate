import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideArchive, LucidePencil, LucidePlus } from '@lucide/angular';
import {
  listAccounts,
  createAccount,
  updateAccount,
  archiveAccount,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { Account, AccountKind } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { FormField } from '../../shared/ui/form-field/form-field';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Modal } from '../../shared/ui/modal/modal';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const KINDS: AccountKind[] = ['cash', 'bank', 'card', 'wallet', 'other'];

@Component({
  selector: 'app-accounts',
  imports: [
    ReactiveFormsModule,
    MoneyPipe,
    LucideArchive,
    LucidePencil,
    LucidePlus,
    Button,
    IconButton,
    Banner,
    EmptyState,
    ListRow,
    FormField,
    Skeleton,
    Modal,
    ConfirmDialog,
    SelectField,
  ],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss',
})
export class Accounts implements OnInit {
  private readonly fb = inject(FormBuilder);
  /** Themed-dropdown options for the account type (native <select> can't be styled in the WebView). */
  protected readonly kindOptions: SelectOption[] = KINDS.map((k) => ({ value: k, label: k }));
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3];
  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);
  protected readonly editing = computed(() => this.editingId() !== null);
  /** The account pending archive confirmation (A14); null when no confirm is open. */
  protected readonly archivingAccount = signal<Account | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    accountType: ['cash' as AccountKind, Validators.required],
    currency: ['MUR', [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]],
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  // ── Inline validation messages (A9) — message only when invalid AND touched; null otherwise. ──
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

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage accounts.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.accounts.set(await listAccounts(false));
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected startCreate(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', accountType: 'cash', currency: 'MUR' });
    this.showForm.set(true);
  }

  protected startEdit(a: Account): void {
    this.editingId.set(a.id);
    this.form.reset({ name: a.name, accountType: a.accountType, currency: a.currency });
    this.showForm.set(true);
  }

  protected cancel(): void {
    this.showForm.set(false);
    this.error.set(null);
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
        const existing = this.accounts().find((a) => a.id === id);
        await updateAccount({
          id,
          name,
          accountType,
          currency,
          openingBalanceMinor: existing?.openingBalanceMinor ?? 0,
        });
      }
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Open the archive confirmation for an account (A14) — archive never fires straight from the row. */
  protected confirmArchive(a: Account): void {
    this.error.set(null);
    this.archivingAccount.set(a);
  }

  protected async archiveConfirmed(): Promise<void> {
    const a = this.archivingAccount();
    if (!a) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await archiveAccount(a.id);
      this.archivingAccount.set(null);
      await this.reload();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
