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
});
