import { Component, OnInit, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import {
  NavigationEnd,
  Router,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import { filter } from 'rxjs/operators';
import {
  LucideHouse,
  LucideWallet,
  LucideTarget,
  LucidePieChart,
  LucideSettings,
  LucideArrowLeft,
} from '@lucide/angular';
import { getAppInfo, dbHealth, isTauri } from './core/bridge';
import type { AppInfo, DbHealth } from './core/models';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    // All icons come from @lucide/angular (bundled, tree-shaken). See .claude/rules/design.md.
    LucideHouse,
    LucideWallet,
    LucideTarget,
    LucidePieChart,
    LucideSettings,
    LucideArrowLeft,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  // Walking-skeleton diagnostics proving the Angular ↔ Rust bridge end to end.
  protected readonly appInfo = signal<AppInfo | null>(null);
  protected readonly health = signal<DbHealth | null>(null);
  protected readonly coreError = signal<string | null>(null);

  // AppHeader state, driven by the active route's `data` (see app.routes.ts). Home omits
  // `title`, so the header shows the "BudgetMate" brand wordmark; titled screens show their name.
  protected readonly pageTitle = signal('BudgetMate');
  protected readonly isBrand = signal(true);
  protected readonly hasBack = signal(false);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.syncHeader());
  }

  // Header navigates back through history; multiple screens have several entry points, so a
  // fixed target would be wrong. The app always launches at /home, so history is populated.
  protected goBack(): void {
    this.location.back();
  }

  private syncHeader(): void {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    const title = route.data['title'] as string | undefined;
    this.pageTitle.set(title ?? 'BudgetMate');
    this.isBrand.set(!title);
    this.hasBack.set(!!route.data['back']);
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      // Plain browser preview (ng serve) — the Rust core isn't present.
      this.coreError.set('Running in browser preview (no Tauri core).');
      return;
    }
    try {
      this.appInfo.set(await getAppInfo());
      this.health.set(await dbHealth());
    } catch (err) {
      this.coreError.set(String(err));
    }
  }
}
