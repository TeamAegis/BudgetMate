import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Settings } from './settings';

/**
 * `core/bridge` re-exports named ES functions, which Jasmine's `spyOn` cannot redefine on a module
 * namespace object (same constraint documented in `import-file.spec.ts`/`export.spec.ts`/
 * `home.spec.ts`). Karma never runs inside the Tauri runtime, so `isTauri()` is reliably `false` by
 * default; to exercise the real bridge-calling paths (`ngOnInit`'s `getSettings`, and
 * `onDedupWindowChange`'s `setDedupWindow`) this file sets `globalThis.__TAURI_INTERNALS__`
 * directly and branches on the invoked command name, exactly as `isTauri()`/`invoke()` key off it.
 * This file imports NOTHING from `@tauri-apps/api` - only the component under test, which itself
 * only ever imports from `core/bridge`.
 */
describe('Settings', () => {
  function createFixture() {
    TestBed.configureTestingModule({
      imports: [Settings],
      providers: [provideRouter([])],
    });
    return TestBed.createComponent(Settings);
  }

  function withTauriInternals(invoke: (cmd: string, args?: unknown) => Promise<unknown>): () => void {
    const globalWithInternals = globalThis as { __TAURI_INTERNALS__?: unknown };
    const prior = globalWithInternals.__TAURI_INTERNALS__;
    globalWithInternals.__TAURI_INTERNALS__ = { invoke };
    return () => {
      globalWithInternals.__TAURI_INTERNALS__ = prior;
    };
  }

  type SettingsInternals = {
    baseCurrency: { (): string };
    dedupWindowDays: { (): number };
    onDedupWindowChange(v: number | string): Promise<void>;
  };

  it('outside the Tauri runtime, ngOnInit is a guarded no-op that keeps the defaults', async () => {
    const fixture = createFixture();
    fixture.detectChanges(); // runs ngOnInit -> !isTauri() -> returns before calling getSettings
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as SettingsInternals;
    expect(component.baseCurrency()).toBe('MUR');
    expect(component.dedupWindowDays()).toBe(3);
  });

  it('ngOnInit reads getSettings and reflects the configured dedup window', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'get_settings') {
        return Promise.resolve({
          idleTimeoutSecs: 120,
          biometricEnabled: false,
          baseCurrency: 'MUR',
          dedupWindowDays: 7,
        });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const component = fixture.componentInstance as unknown as SettingsInternals;
      expect(component.baseCurrency()).toBe('MUR');
      expect(component.dedupWindowDays()).toBe(7);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Duplicate detection');
      expect(host.textContent).toContain('1 week');
    } finally {
      restore();
    }
  });

  it('a failed getSettings read is non-fatal: the dedup window default stays, controls still render', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'get_settings') return Promise.reject({ kind: 'internal', message: 'boom' });
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const component = fixture.componentInstance as unknown as SettingsInternals;
      expect(component.dedupWindowDays()).toBe(3);
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Duplicate detection');
    } finally {
      restore();
    }
  });

  it('onDedupWindowChange calls setDedupWindow with the chosen number and updates the signal', async () => {
    let capturedArgs: unknown;
    const restore = withTauriInternals((cmd, args) => {
      if (cmd === 'set_dedup_window') {
        capturedArgs = args;
        return Promise.resolve({
          idleTimeoutSecs: 120,
          biometricEnabled: false,
          baseCurrency: 'MUR',
          dedupWindowDays: 14,
        });
      }
      return Promise.resolve(null);
    });
    try {
      // Deliberately skip `fixture.detectChanges()` (which would run `ngOnInit`'s own
      // `getSettings` call and race with the change below) - `onDedupWindowChange` doesn't touch
      // the template, so calling it directly on the freshly-constructed component is enough.
      const fixture = createFixture();
      const component = fixture.componentInstance as unknown as SettingsInternals;

      await component.onDedupWindowChange(14);

      expect(capturedArgs).toEqual({ days: 14 });
      expect(component.dedupWindowDays()).toBe(14);
    } finally {
      restore();
    }
  });

  it('onDedupWindowChange coerces a string value (as the select-field emits) to a number', async () => {
    let capturedArgs: unknown;
    const restore = withTauriInternals((cmd, args) => {
      if (cmd === 'set_dedup_window') {
        capturedArgs = args;
        return Promise.resolve({
          idleTimeoutSecs: 120,
          biometricEnabled: false,
          baseCurrency: 'MUR',
          dedupWindowDays: 0,
        });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      const component = fixture.componentInstance as unknown as SettingsInternals;

      await component.onDedupWindowChange('0');

      expect(capturedArgs).toEqual({ days: 0 });
      expect(component.dedupWindowDays()).toBe(0);
    } finally {
      restore();
    }
  });
});
