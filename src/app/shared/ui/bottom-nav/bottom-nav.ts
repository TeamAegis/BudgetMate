import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideHouse, LucideWallet, LucideTarget, LucidePieChart } from '@lucide/angular';
import { NavTabService } from '../../../core/layout/nav-tab.service';

/**
 * Canonical bottom navigation (design-system.md §7): four evenly-spaced tabs -
 * Home · Expenses · Goals · Analytics - active tab in accessible coral.
 *
 * The active tab comes from `NavTabService`, NOT from `routerLinkActive`. Prefix matching alone lit
 * nothing at all on the routes that sit outside the four tab prefixes (`/settings/**`,
 * `/budgets/**`, `/allowances/**`, `/import/**`), so the nav looked like it had lost its place. The
 * service resolves the owning tab from the route's `data.tab`, falling back to the URL's first
 * segment - see its doc comment for the full rule.
 */
@Component({
  selector: 'app-bottom-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideHouse, LucideWallet, LucideTarget, LucidePieChart],
  template: `
    <nav class="app-nav" aria-label="Main navigation">
      <a
        routerLink="/home"
        [class.active]="activeTab() === 'home'"
        [attr.aria-current]="activeTab() === 'home' ? 'page' : null"
      >
        <svg lucideHouse [size]="22" aria-hidden="true"></svg>
        <span>Home</span>
      </a>
      <a
        routerLink="/expenses"
        [class.active]="activeTab() === 'expenses'"
        [attr.aria-current]="activeTab() === 'expenses' ? 'page' : null"
      >
        <svg lucideWallet [size]="22" aria-hidden="true"></svg>
        <span>Expenses</span>
      </a>
      <a
        routerLink="/goals"
        [class.active]="activeTab() === 'goals'"
        [attr.aria-current]="activeTab() === 'goals' ? 'page' : null"
      >
        <svg lucideTarget [size]="22" aria-hidden="true"></svg>
        <span>Goals</span>
      </a>
      <a
        routerLink="/analytics"
        [class.active]="activeTab() === 'analytics'"
        [attr.aria-current]="activeTab() === 'analytics' ? 'page' : null"
      >
        <svg lucidePieChart [size]="22" aria-hidden="true"></svg>
        <span>Analytics</span>
      </a>
    </nav>
  `,
  styleUrl: './bottom-nav.scss',
})
export class BottomNav {
  protected readonly activeTab = inject(NavTabService).activeTab;
}
