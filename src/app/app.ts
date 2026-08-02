import { Component, OnInit, effect, inject, isDevMode, signal } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Params, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { getAppInfo, dbHealth, isTauri } from './core/bridge';
import { LockService } from './core/lock/lock.service';
import { ViewportInsetsService } from './core/layout/viewport-insets.service';
import { HeaderActionService } from './core/layout/header-action.service';
import { NavTabService } from './core/layout/nav-tab.service';
import {
  MONEY_DESTINATIONS,
  GENERAL_DESTINATIONS,
  SETTINGS_DESTINATION,
} from './core/layout/nav-destinations';
import type { AppInfo, DbHealth } from './core/models';
import { AppHeader } from './shared/ui/app-header/app-header';
import { BottomNav } from './shared/ui/bottom-nav/bottom-nav';
import { NavDrawer, type NavDrawerGroup } from './shared/ui/nav-drawer/nav-drawer';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AppHeader, BottomNav, NavDrawer],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly lock = inject(LockService);
  private readonly viewportInsets = inject(ViewportInsetsService);
  // The active page's trailing header action (e.g. a form's Save); see HeaderActionService.
  protected readonly headerAction = inject(HeaderActionService);
  // Which bottom-nav tab owns the current screen, so pushed screens keep their tab lit.
  private readonly navTab = inject(NavTabService);

  // Walking-skeleton diagnostics proving the Angular ↔ Rust bridge end to end.
  protected readonly appInfo = signal<AppInfo | null>(null);
  protected readonly health = signal<DbHealth | null>(null);
  protected readonly coreError = signal<string | null>(null);
  // The bridge diagnostics strip is a dev-only aid; keep it during `tauri dev` / `npm run start`
  // but strip it from the optimized production Android build so it never ships on feature screens.
  // isDevMode() is false under an AOT production build and true under the dev server (no env files).
  protected readonly showDiagnostics = isDevMode();

  // AppHeader state, driven by the active route's `data` (see app.routes.ts). Home omits
  // `title`, so the header shows the "BudgetMate" brand wordmark; titled screens show their name.
  protected readonly pageTitle = signal('BudgetMate');
  protected readonly isBrand = signal(true);
  protected readonly hasBack = signal(false);
  // The lock screens (/setup, /unlock) render without the app header / status / bottom nav.
  protected readonly chromeless = signal(false);
  // Full-screen task pages (the add/edit form routes) keep the header but hide the bottom nav, so
  // the user is focused on one task and exits via Back/Cancel (old-Juice page-flow model).
  protected readonly hideNav = signal(false);

  /**
   * Nav-drawer visibility (ADR 0013). Owned here, not by the drawer, because the header button that
   * opens it and the sheet itself are siblings in the shell.
   */
  protected readonly drawerOpen = signal(false);

  /**
   * The drawer's contents. The four primary destinations are deliberately absent - they live in the
   * always-visible BottomNav, and repeating them would teach that the drawer is where navigation
   * happens. Rendered from `core/layout/nav-destinations`, the same list Settings uses.
   */
  protected readonly drawerGroups: readonly NavDrawerGroup[] = [
    { title: 'Your money', items: MONEY_DESTINATIONS },
    { title: 'General', items: [...GENERAL_DESTINATIONS, SETTINGS_DESTINATION] },
  ];

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => {
        this.syncHeader();
        // Any navigation closes the drawer: tapping one of its rows (it has done its job), and also
        // Android's hardware Back, which pops history without the drawer knowing - leaving it open
        // over a page the user has already left.
        this.drawerOpen.set(false);
      });

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

  protected openDrawer(): void {
    this.drawerOpen.set(true);
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  private syncHeader(): void {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    // `title` is normally a static string; on the param-driven add routes it is a function of the
    // route params (e.g. `:kind` -> "New expense" / "New income") resolved at navigation time.
    const titleData = route.data['title'] as string | ((params: Params) => string) | undefined;
    const title = typeof titleData === 'function' ? titleData(route.params) : titleData;
    this.pageTitle.set(title ?? 'BudgetMate');
    this.isBrand.set(!title);
    this.hasBack.set(!!route.data['back']);
    this.chromeless.set(!!route.data['chromeless']);
    this.hideNav.set(!!route.data['hideNav']);
    // Publish the owning tab: `data.tab` when declared, else inferred from the URL's first segment.
    this.navTab.sync(route.data['tab'], this.router.url);
  }

  async ngOnInit(): Promise<void> {
    // Publish the keyboard inset as --keyboard-inset for keyboard-aware bottom layout (Android
    // WebView doesn't resize for the keyboard - see core/layout/viewport-insets.service.ts).
    this.viewportInsets.start();

    if (!isTauri()) {
      // Plain browser preview (ng serve) - the Rust core isn't present.
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
