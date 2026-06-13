import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LockService } from './lock.service';

describe('LockService', () => {
  let lock: LockService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    lock = TestBed.inject(LockService);
    router = TestBed.inject(Router);
  });

  it('lock() clears the unlocked flag and routes to /unlock', async () => {
    lock.unlocked.set(true);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    await lock.lock();
    expect(lock.unlocked()).toBe(false);
    expect(nav).toHaveBeenCalledWith(['/unlock']);
  });

  it('refreshState() is inert outside the Tauri runtime', async () => {
    // No __TAURI_INTERNALS__ in the Karma browser → isTauri() is false.
    await expectAsync(lock.refreshState()).toBeResolvedTo(null);
    expect(lock.unlocked()).toBe(false);
  });

  // The `onVisibility` handler is private; arm the listeners (which bind it) then dispatch a real
  // `visibilitychange` with `visibilityState` stubbed to 'hidden' to exercise the actual code path.
  function hideDocument(): void {
    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('visibility→hidden locks normally (no trusted excursion active)', () => {
    spyOn(router, 'navigate').and.resolveTo(true);
    lock.unlocked.set(true);
    // Arm the security timers/listeners (binds the visibility handler).
    (lock as unknown as { armSecurityTimers(): void }).armSecurityTimers();
    const lockSpy = spyOn(lock, 'lock').and.resolveTo();

    hideDocument();

    expect(lockSpy).toHaveBeenCalled();
  });

  it('visibility→hidden does NOT lock while a trusted excursion is active', () => {
    spyOn(router, 'navigate').and.resolveTo(true);
    lock.unlocked.set(true);
    (lock as unknown as { armSecurityTimers(): void }).armSecurityTimers();
    const lockSpy = spyOn(lock, 'lock').and.resolveTo();

    lock.beginTrustedExcursion();
    hideDocument();

    expect(lockSpy).not.toHaveBeenCalled();
  });

  it('clears the excursion flag so a later background locks again', () => {
    spyOn(router, 'navigate').and.resolveTo(true);
    lock.unlocked.set(true);
    (lock as unknown as { armSecurityTimers(): void }).armSecurityTimers();
    const lockSpy = spyOn(lock, 'lock').and.resolveTo();

    lock.beginTrustedExcursion();
    lock.endTrustedExcursion();
    hideDocument();

    expect(lockSpy).toHaveBeenCalled();
  });
});
