import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideArchive, LucidePencil, LucidePlus, LucideArrowLeft } from '@lucide/angular';
import {
  listAccounts,
  createAccount,
  updateAccount,
  archiveAccount,
  isTauri,
} from '../../core/bridge';
import type { Account, AccountKind } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

const KINDS: AccountKind[] = ['cash', 'bank', 'card', 'wallet', 'other'];

@Component({
  selector: 'app-accounts',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MoneyPipe,
    LucideArchive,
    LucidePencil,
    LucidePlus,
    LucideArrowLeft,
  ],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss',
})
export class Accounts implements OnInit {
  private readonly fb = inject(FormBuilder);
  protected readonly kinds = KINDS;
  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    accountType: ['cash' as AccountKind, Validators.required],
    currency: ['MUR', [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]],
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
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
      this.error.set(String(e));
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
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async archive(a: Account): Promise<void> {
    this.busy.set(true);
    try {
      await archiveAccount(a.id);
      await this.reload();
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
