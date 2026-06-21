import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { LockService } from './lock.service';

/**
 * Blocks every feature route until the vault is unlocked. While locked it sends the user to the
 * first-run `/setup` screen (no passphrase yet) or `/unlock` otherwise. No feature route - and
 * therefore no DB-backed command - runs before unlock.
 */
export const unlockGuard: CanActivateFn = () => {
  const lock = inject(LockService);
  const router = inject(Router);

  if (lock.unlocked()) return true;
  return router.createUrlTree([lock.initialized() ? '/unlock' : '/setup']);
};
