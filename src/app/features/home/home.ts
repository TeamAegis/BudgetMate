import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucidePlus, LucideTarget, LucideScanLine } from '@lucide/angular';

@Component({
  selector: 'app-home',
  imports: [RouterLink, LucidePlus, LucideTarget, LucideScanLine],
  template: `
    <section class="feature-page">
      <!-- BalanceCard (hero) — screens.md §3. Placeholder until get_dashboard() lands. -->
      <div class="balance-card">
        <span class="label">Current Balance</span>
        <span class="amount numeric">Rs 0</span>
        <span class="label">Usable balance · Rs 0</span>
      </div>

      <div class="quick-actions">
        <a class="chip" routerLink="/expenses" animate.enter="list-item-enter">
          <svg lucidePlus [size]="20" aria-hidden="true"></svg>
          <span>Transaction</span>
        </a>
        <a class="chip" routerLink="/goals" animate.enter="list-item-enter">
          <svg lucideTarget [size]="20" aria-hidden="true"></svg>
          <span>Goal</span>
        </a>
        <a class="chip" routerLink="/import" animate.enter="list-item-enter">
          <svg lucideScanLine [size]="20" aria-hidden="true"></svg>
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
      min-height: var(--tap-target-min); // guarantee the 44px target floor
      background: var(--c-primary-05);
      border-radius: var(--radius-sm);
      color: var(--c-primary-700);
      font-size: var(--t-caption);
      text-align: center;
      text-decoration: none;
    }
    // Token-driven entrance stagger (zeros under prefers-reduced-motion, unlike a hardcoded ms).
    .quick-actions .chip:nth-child(2) {
      animation-delay: var(--motion-fast);
    }
    .quick-actions .chip:nth-child(3) {
      animation-delay: var(--motion-standard);
    }
  `,
})
export class Home {}
