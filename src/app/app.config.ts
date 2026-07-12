import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideLucideConfig } from '@lucide/angular';

import { routes } from './app.routes';
import { LockService } from './core/lock/lock.service';
import { CurrencyService } from './core/money/currency.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Resolve vault/lock state BEFORE the first route activates, so the unlock guard routes to
    // /setup or /unlock correctly on cold start (no flash of the wrong lock screen).
    provideAppInitializer(() => inject(LockService).refreshState()),
    // Cache the authoritative currency minor-unit-digit table (reads no DB, safe while locked).
    provideAppInitializer(() => inject(CurrencyService).load()),
    // Global icon defaults - refined single-weight outline to match the light Poppins type.
    provideLucideConfig({ strokeWidth: 1.75 }),
  ],
};
