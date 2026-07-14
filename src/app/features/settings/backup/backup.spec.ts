import { TestBed } from '@angular/core/testing';
import { Backup } from './backup';

/**
 * `core/bridge` re-exports named ES functions, which Jasmine's `spyOn` cannot redefine on a module
 * namespace object (same constraint noted in `export.spec.ts`/`reports.spec.ts`). Karma never runs
 * inside the Tauri runtime, so `isTauri()` is reliably `false` by default - that drives the genuine
 * "not running in the app shell" error state for free. To exercise the real bridge-calling paths
 * (`ngOnInit`'s `getAppInfo`, and `backup()`'s `pickBackupDestination`/`createBackup`), this file
 * sets `globalThis.__TAURI_INTERNALS__` directly and branches on the invoked command name -
 * `pickBackupDestination` calls the dialog plugin's `save()`, which itself calls
 * `invoke('plugin:dialog|save', ...)`, so the same seam covers both. This file imports NOTHING
 * from `@tauri-apps/api` (only the component, under test).
 */
describe('Backup', () => {
  function createFixture() {
    TestBed.configureTestingModule({ imports: [Backup] });
    return TestBed.createComponent(Backup);
  }

  function withTauriInternals(invoke: (cmd: string, args?: unknown) => Promise<unknown>): () => void {
    const globalWithInternals = globalThis as { __TAURI_INTERNALS__?: unknown };
    const prior = globalWithInternals.__TAURI_INTERNALS__;
    globalWithInternals.__TAURI_INTERNALS__ = { invoke };
    return () => {
      globalWithInternals.__TAURI_INTERNALS__ = prior;
    };
  }

  it('error state: outside the Tauri runtime, ngOnInit reports the plain-language message with no controls', () => {
    const fixture = createFixture();
    fixture.detectChanges(); // runs ngOnInit -> !isTauri() -> guarded no-op with an error message

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Run the app');
    const buttons = host.querySelectorAll('app-button');
    // The blocking-error branch offers only a "Try again" retry button, never Create backup.
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent?.trim()).toBe('Try again');
  });

  it('loading state: skeleton placeholders render while ngOnInit has not resolved yet', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { loading: { set(v: boolean): void } };
    component.loading.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('app-skeleton').length).toBeGreaterThan(0);
  });

  it('android: the info banner replaces the backup controls', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'get_app_info') {
        return Promise.resolve({ name: 'BudgetMate', version: '0.1.0', platform: 'android' });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Backup is available on the desktop app for now.');
      expect(host.textContent).not.toContain('This backup is encrypted');
    } finally {
      restore();
    }
  });

  it('populated state: the encryption banner and an enabled Create backup button render', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'get_app_info') {
        return Promise.resolve({ name: 'BudgetMate', version: '0.1.0', platform: 'windows' });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('This backup is encrypted');
      expect(host.textContent).toContain("What's saved");
      const button = host.querySelector('app-button button') as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(button.disabled).toBeFalse();
      expect(button.textContent).toContain('Create backup');
    } finally {
      restore();
    }
  });

  it('cancelling the save dialog is a silent no-op: no busy flicker, no error, no summary', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'plugin:dialog|save') return Promise.resolve(null); // user cancelled
      return Promise.resolve(null);
    });
    try {
      // Deliberately skip `fixture.detectChanges()` (which would run `ngOnInit`'s own
      // `getAppInfo` call and race with `backup()` below) - `backup()` doesn't touch the
      // template, so calling it directly on the freshly-constructed component is enough.
      const fixture = createFixture();
      const component = fixture.componentInstance as unknown as {
        busy: { (): boolean };
        actionError: { (): string | null };
        savedSummary: { (): unknown };
        backup(): Promise<void>;
      };

      await component.backup();

      expect(component.busy()).toBeFalse();
      expect(component.actionError()).toBeNull();
      expect(component.savedSummary()).toBeNull();
    } finally {
      restore();
    }
  });

  it('double-tap guard: a second backup() call while the save picker is still open is a no-op', async () => {
    let saveCallCount = 0;
    let resolveSave!: (value: unknown) => void;
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'plugin:dialog|save') {
        saveCallCount++;
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      const component = fixture.componentInstance as unknown as {
        backup(): Promise<void>;
      };

      // Fire two fast taps before the picker resolves - the second call must not open a second
      // save dialog (the in-flight guard is set synchronously, before awaiting the picker).
      const first = component.backup();
      const second = component.backup();
      resolveSave('/tmp/budgetmate-backup-2026-07-14.vaultbak');
      await Promise.all([first, second]);

      expect(saveCallCount).toBe(1);
    } finally {
      restore();
    }
  });

  it('busy -> saved: backup() goes busy while createBackup is in flight, then shows the success banner', async () => {
    let resolveCreate!: (value: unknown) => void;
    const restore = withTauriInternals((cmd) => {
      // `get_app_info` backs `ngOnInit` (triggered by `detectChanges()` below) - it must resolve
      // cleanly to a normal desktop/populated state so it doesn't race the `backup()` call
      // underneath with an unrelated error.
      if (cmd === 'get_app_info') {
        return Promise.resolve({ name: 'BudgetMate', version: '0.1.0', platform: 'windows' });
      }
      if (cmd === 'plugin:dialog|save') {
        return Promise.resolve('/tmp/budgetmate-backup-2026-07-14.vaultbak');
      }
      if (cmd === 'create_backup') {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable(); // let ngOnInit settle to the populated state first
      fixture.detectChanges();
      const component = fixture.componentInstance as unknown as {
        busy: { (): boolean };
        savedSummary: { (): { path: string } | null };
        backup(): Promise<void>;
      };

      const pending = component.backup();
      // Let the microtask queue drain up to the point where `busy` is set but `resolveCreate` has
      // been captured and the backup promise hasn't resolved yet. The exact number of microtask
      // hops through `pickBackupDestination` -> the dialog plugin's own `save()` -> `invoke()` is
      // an implementation detail, so poll a macrotask at a time (each `setTimeout` flushes every
      // pending microtask first) rather than guessing a fixed tick count.
      while (!resolveCreate) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(component.busy()).toBeTrue();

      resolveCreate({
        path: '/tmp/budgetmate-backup-2026-07-14.vaultbak',
        byteLen: 4096,
        formatVersion: 1,
      });
      await pending;

      expect(component.busy()).toBeFalse();
      const summary = component.savedSummary();
      expect(summary?.path).toBe('/tmp/budgetmate-backup-2026-07-14.vaultbak');

      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Backup saved to');
      expect(host.textContent).toContain('budgetmate-backup-2026-07-14.vaultbak');
    } finally {
      restore();
    }
  });

  it('action error: a rejected backup shows an inline error banner WITHOUT hiding the encryption note or controls', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'get_app_info') {
        return Promise.resolve({ name: 'BudgetMate', version: '0.1.0', platform: 'windows' });
      }
      if (cmd === 'plugin:dialog|save') return Promise.resolve('/tmp/out.vaultbak');
      if (cmd === 'create_backup') {
        return Promise.reject({ kind: 'internal', message: 'disk write failed' });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable(); // let ngOnInit settle to the populated state first
      fixture.detectChanges();
      const component = fixture.componentInstance as unknown as {
        actionError: { (): string | null };
        backup(): Promise<void>;
      };

      await component.backup();
      fixture.detectChanges();

      expect(component.actionError()).not.toBeNull();
      const host = fixture.nativeElement as HTMLElement;
      // The action failure must NOT route into the blocking "Try again" view: the encryption note
      // and Create backup button stay in the DOM, and an inline error banner appears alongside
      // them (not instead of them).
      expect(host.textContent).toContain('This backup is encrypted');
      expect(host.querySelector('app-button button')).not.toBeNull();
      expect(host.textContent).not.toContain('Try again');
      // "disk write failed" doesn't match a known heuristic in `toUserMessage`, so it maps to the
      // generic plain-language fallback - still shown inline, not swallowed.
      expect(host.textContent).toContain('Something went wrong');
    } finally {
      restore();
    }
  });

  it('load error: a rejected initial load shows the blocking Try-again view, not the populated controls', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'get_app_info') {
        return Promise.reject({ kind: 'internal', message: 'could not read app info' });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Something went wrong');
      expect(host.textContent).toContain('Try again');
      // The blocking view replaces the populated state entirely: no encryption note, no button.
      expect(host.textContent).not.toContain('This backup is encrypted');
    } finally {
      restore();
    }
  });
});
