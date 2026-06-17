import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { getAppInfo, dbHealth, isTauri } from './core/bridge';
import { LockService } from './core/lock/lock.service';
import { ViewportInsetsService } from './core/layout/viewport-insets.service';
import type { AppInfo, DbHealth } from './core/models';
import { AppHeader } from './shared/ui/app-header/app-header';
import { BottomNav } from './shared/ui/bottom-nav/bottom-nav';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AppHeader, BottomNav],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly lock = inject(LockService);
  private readonly viewportInsets = inject(ViewportInsetsService);

  // Walking-skeleton diagnostics proving the Angular ↔ Rust bridge end to end.
  protected readonly appInfo = signal<AppInfo | null>(null);
  protected readonly health = signal<DbHealth | null>(null);
  protected readonly coreError = signal<string | null>(null);

  // AppHeader state, driven by the active route's `data` (see app.routes.ts). Home omits
  // `title`, so the header shows the "BudgetMate" brand wordmark; titled screens show their name.
  protected readonly pageTitle = signal('BudgetMate');
  protected readonly isBrand = signal(true);
  protected readonly hasBack = signal(false);
  // The lock screens (/setup, /unlock) render without the app header / status / bottom nav.
  protected readonly chromeless = signal(false);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.syncHeader());

    // The encrypted DB is only readable once unlocked: fetch the health diagnostic when the vault
    // unlocks, and clear it on lock. (Locked db_health would just error.)
    effect(() => {
      if (this.lock.unlocked()) {
        void this.refreshDiagnostics();
      } else {
        this.health.set(null);
      }
    });
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
    this.chromeless.set(!!route.data['chromeless']);
  }

  async ngOnInit(): Promise<void> {
    // Publish the keyboard inset as --keyboard-inset for keyboard-aware bottom layout (Android
    // WebView doesn't resize for the keyboard — see core/layout/viewport-insets.service.ts).
    this.viewportInsets.start();

    if (!isTauri()) {
      // Plain browser preview (ng serve) — the Rust core isn't present.
      this.coreError.set('Running in browser preview (no Tauri core).');
      return;
    }
    try {
      // App info needs no unlock; DB health is fetched by the effect once the vault is unlocked.
      this.appInfo.set(await getAppInfo());
    } catch (err) {
      this.coreError.set(String(err));
    }
  }

  private async refreshDiagnostics(): Promise<void> {
    try {
      this.health.set(await dbHealth());
    } catch (err) {
      this.coreError.set(String(err));
    }
  }
}
