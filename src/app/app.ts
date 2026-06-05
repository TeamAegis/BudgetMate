import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { getAppInfo, dbHealth, isTauri } from './core/bridge';
import type { AppInfo, DbHealth } from './core/models';

interface NavItem {
  path: string;
  label: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly nav: NavItem[] = [
    { path: '/transactions', label: 'Transactions' },
    { path: '/budgets', label: 'Budgets' },
    { path: '/goals', label: 'Goals' },
    { path: '/reports', label: 'Reports' },
    { path: '/import', label: 'Import' },
    { path: '/settings', label: 'Settings' },
  ];

  // Walking-skeleton diagnostics proving the Angular ↔ Rust bridge end to end.
  protected readonly appInfo = signal<AppInfo | null>(null);
  protected readonly health = signal<DbHealth | null>(null);
  protected readonly coreError = signal<string | null>(null);

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
