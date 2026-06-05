import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucidePlus, LucideTarget, LucideScanLine } from '@lucide/angular';

@Component({
  selector: 'app-home',
  imports: [RouterLink, LucidePlus, LucideTarget, LucideScanLine],
  template: `
    <section class="feature-page">
      <h1>Home</h1>

      <!-- BalanceCard (hero) — screens.md §3. Placeholder until get_dashboard() lands. -->
      <div class="balance-card">
        <span class="label">Current Balance</span>
        <span class="amount numeric">Rs 0</span>
        <span class="label">Usable balance · Rs 0</span>
      </div>

      <div class="quick-actions">
        <a class="chip" routerLink="/expenses">
          <svg lucidePlus [size]="20"></svg>
          <span>Transaction</span>
        </a>
        <a class="chip" routerLink="/goals">
          <svg lucideTarget [size]="20"></svg>
          <span>Goal</span>
        </a>
        <a class="chip" routerLink="/import">
          <svg lucideScanLine [size]="20"></svg>
          <span>Scan / Import</span>
        </a>
      </div>

      <p class="muted">
        Dashboard: balance, usable-balance trend (Chart.js), quick actions and a goals preview
        (FR-3.x). Wired to the Rust <code>get_dashboard()</code> command in a later change.
      </p>
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .muted {
      color: var(--c-text-muted);
    }
    .balance-card {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-5);
      background: var(--c-primary-40);
      border-radius: var(--radius-lg);
      box-shadow: var(--elev-card);
    }
    .balance-card .label {
      font-size: var(--t-section);
      color: var(--c-text);
    }
    .balance-card .amount {
      font-size: var(--t-balance);
      font-weight: var(--fw-extralight);
      color: var(--c-text);
    }
    .quick-actions {
      display: flex;
      gap: var(--space-3);
    }
    .quick-actions .chip {
      flex: 1 1 0; // equal-width columns so the three align
      display: inline-flex;
      flex-direction: column; // icon on top, label below
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: var(--space-4) var(--space-2);
      background: var(--c-primary-05);
      border-radius: var(--radius-sm);
      color: var(--c-primary-700);
      font-size: var(--t-caption);
      text-align: center;
      text-decoration: none;
    }
  `,
})
export class Home {}
