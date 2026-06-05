import { Injectable, signal } from '@angular/core';

/**
 * App lock state (FR-5.1 / FR-5.2). At launch, after an idle timeout, and on background the app
 * is locked; unlocking goes through biometric/passphrase which releases the DB key into memory
 * in the Rust core. This skeleton tracks lock state only — the biometric/passphrase flow and the
 * Rust key-unlock command are wired in a later change (see docs/architecture.md §5.2).
 */
@Injectable({ providedIn: 'root' })
export class LockService {
  /** True once the user has authenticated and the DB key is unlocked in the Rust core. */
  readonly unlocked = signal(false);

  /** Called by the unlock flow after the Rust core confirms the key is set. */
  markUnlocked(): void {
    this.unlocked.set(true);
  }

  /** Lock on background/idle: signals the Rust core to zeroise the in-memory key (TODO). */
  lock(): void {
    this.unlocked.set(false);
  }
}
