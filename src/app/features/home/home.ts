import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucidePlus, LucideTarget, LucideScanLine } from '@lucide/angular';

/**
 * Home / Dashboard. Old-Juice layout: the balance summary on top, then a grid of LABELLED
 * quick-action tiles (never icon-only - a low-literacy requirement). Each tile is a link to a
 * full-screen page (no modals). The balance figures are a placeholder until the Rust
 * `get_dashboard()` command lands (architecture.md s11). Bottom nav handles browsing; these tiles
 * are for the highest-frequency actions.
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink, LucidePlus, LucideTarget, LucideScanLine],
  template: `
    <section class="feature-page">
      <!-- BalanceCard (hero) - screens.md s3. Placeholder until get_dashboard() lands. -->
      <div class="balance-card">
        <span class="label">Current Balance</span>
        <span class="amount numeric">Rs 0</span>
        <span class="label">Usable balance · Rs 0</span>
      </div>

      <h2 class="section-title">Quick actions</h2>
      <div class="tiles">
        <a class="tile" routerLink="/expenses/new" animate.enter="list-item-enter">
          <span class="tile-glyph"><svg lucidePlus [size]="24" aria-hidden="true"></svg></span>
          <span class="tile-label">Add expense</span>
        </a>
        <a class="tile" routerLink="/import" animate.enter="list-item-enter">
          <span class="tile-glyph"><svg lucideScanLine [size]="24" aria-hidden="true"></svg></span>
          <span class="tile-label">Scan receipt</span>
        </a>
        <a class="tile" routerLink="/goals/new" animate.enter="list-item-enter">
          <span class="tile-glyph"><svg lucideTarget [size]="24" aria-hidden="true"></svg></span>
          <span class="tile-label">Add goal</span>
        </a>
      </div>

      <p class="muted">
        Dashboard: balance, usable-balance trend (Chart.js) and a goals preview (FR-3.x) wire to the
        Rust <code>get_dashboard()</code> command in a later change.
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
    .section-title {
      margin: 0;
      font-size: var(--t-section);
      font-weight: var(--fw-medium);
      color: var(--c-text-muted);
    }
    // Labelled action tiles (old-Juice grid): icon glyph on top, plain-language label below.
    .tiles {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-3);
    }
    .tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: var(--space-4) var(--space-2);
      min-height: calc(var(--tap-target-min) + var(--space-6));
      background: var(--c-primary-05);
      border-radius: var(--radius-md);
      color: var(--c-primary-700);
      text-align: center;
      text-decoration: none;
    }
    .tile:focus-visible {
      outline: 2px solid var(--c-primary-700);
      outline-offset: 2px;
    }
    .tile-glyph {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: var(--radius-pill);
      background: var(--c-primary-10);
    }
    .tile-label {
      font-size: var(--t-caption);
      font-weight: var(--fw-medium);
    }
    // Token-driven entrance stagger (zeros under prefers-reduced-motion, unlike a hardcoded ms).
    .tiles .tile:nth-child(2) {
      animation-delay: var(--motion-fast);
    }
    .tiles .tile:nth-child(3) {
      animation-delay: var(--motion-standard);
    }
  `,
})
export class Home {}
