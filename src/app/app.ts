import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideHouse,
  LucideWallet,
  LucideTarget,
  LucidePieChart,
  LucideSettings,
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
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
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
