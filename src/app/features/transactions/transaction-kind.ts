import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideTrendingDown, LucideTrendingUp, LucideChevronRight } from '@lucide/angular';
import { SettingsRow } from '../../shared/ui/settings-row/settings-row';

/**
 * Step 1a of adding a transaction (FR-1.1): choose what you are recording, money out (expense) or
 * money in (income). A plain navigation list in the Settings style - no Save bar; each row pushes
 * the per-kind category picker (`expenses/new/:kind`). The kind is never a toggle on the form: the
 * category picked next carries it, and Rust derives the sign from the category. See ADR 0004 and
 * `docs/design/screens.md` 8.0. Meaning is carried by label + icon shape; the income tint is only
 * a reinforcement (`.claude/rules/design.md`).
 */
@Component({
  selector: 'app-transaction-kind',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SettingsRow, LucideTrendingDown, LucideTrendingUp, LucideChevronRight],
  template: `
    <section class="feature-page">
      <p class="prompt">What are you recording?</p>
      <ul class="rows">
        <li>
          <a
            app-settings-row
            routerLink="/expenses/new/expense"
            label="Expense"
            hint="Money going out"
          >
            <svg icon lucideTrendingDown [size]="24" aria-hidden="true"></svg>
            <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <a
            app-settings-row
            routerLink="/expenses/new/income"
            label="Income"
            hint="Money coming in"
            tone="income"
          >
            <svg icon lucideTrendingUp [size]="24" aria-hidden="true"></svg>
            <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
          </a>
        </li>
      </ul>
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .prompt {
      margin: 0;
      color: var(--c-text-muted);
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
})
export class TransactionKind {}
