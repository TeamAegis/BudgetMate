import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucidePencil, LucidePlus } from '@lucide/angular';
import { listAccounts, toUserMessage, isTauri } from '../../core/bridge';
import type { Account } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

/**
 * Account list. Smart component: reads accounts through the bridge and renders with shared/ui.
 * Add/Edit are full-screen pages (`settings/accounts/new`, `settings/accounts/:id/edit`) - the Add
 * button and the row's edit button navigate there; archive lives on the edit page. This component
 * never owns a form or a modal. Money formatting goes through the `money` pipe (logic stays in Rust).
 */
@Component({
  selector: 'app-accounts',
  imports: [
    MoneyPipe,
    LucidePencil,
    LucidePlus,
    Button,
    IconButton,
    Banner,
    EmptyState,
    ListRow,
    Skeleton,
  ],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss',
})
export class Accounts implements OnInit {
  private readonly router = inject(Router);
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3];
  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
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

  protected addAccount(): void {
    void this.router.navigate(['/settings/accounts/new']);
  }

  /** Open the edit page, handing the row over via router state (fast path; refresh refetches). */
  protected editAccount(a: Account): void {
    void this.router.navigate(['/settings/accounts', a.id, 'edit'], { state: { account: a } });
  }
}
