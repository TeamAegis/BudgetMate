import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideHouse, LucideWallet, LucideTarget, LucidePieChart } from '@lucide/angular';

/**
 * Canonical bottom navigation (design-system.md §7): four evenly-spaced tabs —
 * Home · Expenses · Goals · Analytics — active tab in accessible coral. Fully self-contained:
 * it owns its routes, icons, and active styling, with no dependence on the host.
 */
@Component({
  selector: 'app-bottom-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, LucideHouse, LucideWallet, LucideTarget, LucidePieChart],
  template: `
    <nav class="app-nav">
      <a routerLink="/home" routerLinkActive="active">
        <svg lucideHouse [size]="22"></svg>
        <span>Home</span>
      </a>
      <a routerLink="/expenses" routerLinkActive="active">
        <svg lucideWallet [size]="22"></svg>
        <span>Expenses</span>
      </a>
      <a routerLink="/goals" routerLinkActive="active">
        <svg lucideTarget [size]="22"></svg>
        <span>Goals</span>
      </a>
      <a routerLink="/analytics" routerLinkActive="active">
        <svg lucidePieChart [size]="22"></svg>
        <span>Analytics</span>
      </a>
    </nav>
  `,
  styleUrl: './bottom-nav.scss',
})
export class BottomNav {}
