import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  appState as fetchAppState,
  setPassphrase as bridgeSetPassphrase,
  unlock as bridgeUnlock,
  unlockWithBiometric as bridgeUnlockBiometric,
  lock as bridgeLock,
  setIdleTimeout as bridgeSetIdleTimeout,
  isTauri,
} from '../bridge';
import type { AppState } from '../models';

/**
 * App lock state + key lifecycle (FR-5.1 / FR-5.2). The DB key lives only in the Rust core; this
 * service mirrors the unlock state, drives unlock/lock IPC, and arms the security timers:
 *  - an idle timer (single `setTimeout`, reset on passive user activity — no polling) that locks
 *    after the configured timeout, and
 *  - a Page-Visibility listener that locks immediately when the app/window is hidden
 *    (backgrounding clears the in-memory key).
 * All DB access is gated by the unlock guard until `unlocked()` is true.
 */
@Injectable({ providedIn: 'root' })
export class LockService {
  private readonly router = inject(Router);

  /** True once the Rust core confirms the DB key is in memory. */
  readonly unlocked = signal(false);
  /** True once a passphrase has been set (vault initialized). */
  readonly initialized = signal(false);
  /** Biometric hardware available on this platform (Android). */
  readonly biometricAvailable = signal(false);
  /** Idle auto-lock timeout in seconds (0 = idle timer disabled). */
  readonly idleTimeoutSecs = signal(0);

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private activityBound = false;
  private readonly onActivity = (): void => this.resetIdleTimer();
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void this.lock();
  };

  /** Pull the current vault/lock state from the core and update signals + timers. */
  async refreshState(): Promise<AppState | null> {
    if (!isTauri()) return null;
    const state = await fetchAppState();
    this.apply(state);
    return state;
  }

  /** First-run: set the passphrase. Throws (rejects) on a weak passphrase / core error. */
  async setPassphrase(passphrase: string): Promise<void> {
    this.apply(await bridgeSetPassphrase(passphrase));
  }

  /** Unlock with the passphrase. Rejects with a generic error on a wrong passphrase. */
  async unlock(passphrase: string): Promise<void> {
    this.apply(await bridgeUnlock(passphrase));
  }

  /** Unlock with biometrics (Android). Rejects where unavailable; callers fall back to passphrase. */
  async unlockWithBiometric(): Promise<void> {
    this.apply(await bridgeUnlockBiometric());
  }

  /** Lock now: drop the core key, stop the timers, and route to the lock screen. */
  async lock(): Promise<void> {
    this.teardownTimers();
    if (this.unlocked()) {
      this.unlocked.set(false);
      if (isTauri()) {
        try {
          await bridgeLock();
        } catch {
          // Locking is best-effort; the UI is already gated.
        }
      }
    }
    void this.router.navigate(['/unlock']);
  }

  /** Update the idle timeout (persisted in the core) and re-arm the timer. */
  async updateIdleTimeout(secs: number): Promise<void> {
    const settings = await bridgeSetIdleTimeout(secs);
    this.idleTimeoutSecs.set(settings.idleTimeoutSecs);
    if (this.unlocked()) this.resetIdleTimer();
  }

  private apply(state: AppState): void {
    this.initialized.set(state.initialized);
    this.biometricAvailable.set(state.biometricAvailable);
    this.idleTimeoutSecs.set(state.idleTimeoutSecs);
    this.unlocked.set(state.unlocked);
    if (state.unlocked) this.armSecurityTimers();
    else this.teardownTimers();
  }

  private armSecurityTimers(): void {
    if (this.activityBound) {
      this.resetIdleTimer();
      return;
    }
    this.activityBound = true;
    document.addEventListener('pointerdown', this.onActivity, { passive: true });
    document.addEventListener('keydown', this.onActivity, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const secs = this.idleTimeoutSecs();
    if (secs > 0) {
      this.idleTimer = setTimeout(() => void this.lock(), secs * 1000);
    }
  }

  private teardownTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.activityBound) {
      document.removeEventListener('pointerdown', this.onActivity);
      document.removeEventListener('keydown', this.onActivity);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.activityBound = false;
    }
  }
}
