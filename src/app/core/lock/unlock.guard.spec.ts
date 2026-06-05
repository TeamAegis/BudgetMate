import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { unlockGuard } from './unlock.guard';
import { LockService } from './lock.service';

describe('unlockGuard', () => {
  let lock: LockService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    lock = TestBed.inject(LockService);
  });

  const run = () =>
    TestBed.runInInjectionContext(() =>
      unlockGuard(
        {} as ActivatedRouteSnapshot,
        { url: '/home' } as RouterStateSnapshot,
      ),
    );

  it('allows navigation when unlocked', () => {
    lock.unlocked.set(true);
    expect(run()).toBe(true);
  });

  it('redirects to /setup when locked and not initialized', () => {
    lock.unlocked.set(false);
    lock.initialized.set(false);
    const result = run() as UrlTree;
    expect(result.toString()).toBe('/setup');
  });

  it('redirects to /unlock when locked and initialized', () => {
    lock.unlocked.set(false);
    lock.initialized.set(true);
    const result = run() as UrlTree;
    expect(result.toString()).toBe('/unlock');
  });
});
