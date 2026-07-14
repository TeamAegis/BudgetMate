import { TestBed } from '@angular/core/testing';
import { Export } from './export';

/**
 * `core/bridge` re-exports named ES functions, which Jasmine's `spyOn` cannot redefine on a module
 * namespace object (same constraint noted in `reports.spec.ts`/`transaction-form.spec.ts`). Karma
 * never runs inside the Tauri runtime, so `isTauri()` is reliably `false` by default - that drives
 * the genuine "not running in the app shell" error state for free. To exercise the real bridge-
 * calling paths (`ngOnInit`'s `getAppInfo`/`listTransactions`, and `export()`'s
 * `pickExportDestination`/`exportTransactions`), this file sets `globalThis.__TAURI_INTERNALS__`
 * directly and branches on the invoked command name - `pickExportDestination` calls the dialog
 * plugin's `save()`, which itself calls `invoke('plugin:dialog|save', ...)`, so the same seam
 * covers both. This file imports NOTHING from `@tauri-apps/api` (only the component, under test).
 */
describe('Export', () => {
  function createFixture() {
    TestBed.configureTestingModule({ imports: [Export] });
    return TestBed.createComponent(Export);
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
    expect(host.querySelector('app-segmented-toggle')).toBeNull();
    // The blocking-error branch offers only a "Try again" retry button, never the Export control.
    const button = host.querySelector('app-button');
    expect(button?.textContent?.trim()).toBe('Try again');
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

  it('android: the info banner replaces the export controls and no plaintext warning is shown', async () => {
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
      expect(host.textContent).toContain('Export is available on the desktop app for now.');
      expect(host.querySelector('app-segmented-toggle')).toBeNull();
      expect(host.textContent).not.toContain('not encrypted');
    } finally {
      restore();
    }
  });

  it('empty state: zero transactions disables Export and shows a hint, warning banner still shown', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'get_app_info') {
        return Promise.resolve({ name: 'BudgetMate', version: '0.1.0', platform: 'windows' });
      }
      if (cmd === 'list_transactions') return Promise.resolve([]);
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('not encrypted');
      expect(host.textContent).toContain("there's nothing to export yet");
      const button = host.querySelector('app-button button') as HTMLButtonElement;
      expect(button.disabled).toBeTrue();
    } finally {
      restore();
    }
  });

  it('populated state: format toggle and an enabled Export button render when transactions exist', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'get_app_info') {
        return Promise.resolve({ name: 'BudgetMate', version: '0.1.0', platform: 'windows' });
      }
      if (cmd === 'list_transactions') return Promise.resolve([{ id: 1 }]);
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('app-segmented-toggle')).not.toBeNull();
      const button = host.querySelector('app-button button') as HTMLButtonElement;
      expect(button.disabled).toBeFalse();
    } finally {
      restore();
    }
  });

  it('onFormatChange updates the format signal', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      format: { (): string };
      onFormatChange(v: string): void;
    };
    expect(component.format()).toBe('csv');
    component.onFormatChange('xlsx');
    expect(component.format()).toBe('xlsx');
  });

  it('cancelling the save dialog is a silent no-op: no busy flicker, no error, no summary', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'plugin:dialog|save') return Promise.resolve(null); // user cancelled
      return Promise.resolve(null);
    });
    try {
      // Deliberately skip `fixture.detectChanges()` (which would run `ngOnInit`'s own
      // `getAppInfo`/`listTransactions` calls and race with `export()` below) - `export()` doesn't
      // touch the template, so calling it directly on the freshly-constructed component is enough.
      const fixture = createFixture();
      const component = fixture.componentInstance as unknown as {
        busy: { (): boolean };
        error: { (): string | null };
        savedSummary: { (): unknown };
        export(): Promise<void>;
      };

      await component.export();

      expect(component.busy()).toBeFalse();
      expect(component.error()).toBeNull();
      expect(component.savedSummary()).toBeNull();
    } finally {
      restore();
    }
  });

  it('busy -> saved: export() goes busy while exportTransactions is in flight, then shows the success banner', async () => {
    let resolveExport!: (value: unknown) => void;
    const restore = withTauriInternals((cmd) => {
      // `get_app_info`/`list_transactions` back `ngOnInit` (triggered by `detectChanges()` below) -
      // both must resolve cleanly to a normal desktop/populated state so it doesn't race the
      // `export()` call underneath with an unrelated error.
      if (cmd === 'get_app_info') {
        return Promise.resolve({ name: 'BudgetMate', version: '0.1.0', platform: 'windows' });
      }
      if (cmd === 'list_transactions') return Promise.resolve([{ id: 1 }]);
      if (cmd === 'plugin:dialog|save') return Promise.resolve('/tmp/budgetmate-export-2026-07-14.csv');
      if (cmd === 'export_transactions') {
        return new Promise((resolve) => {
          resolveExport = resolve;
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
        savedSummary: { (): { rowCount: number; path: string } | null };
        export(): Promise<void>;
      };

      const pending = component.export();
      // Let the microtask queue drain up to the point where `busy` is set but `resolveExport` has
      // been captured and the export promise hasn't resolved yet. The exact number of microtask
      // hops through `pickExportDestination` -> the dialog plugin's own `save()` -> `invoke()` is
      // an implementation detail, so poll a macrotask at a time (each `setTimeout` flushes every
      // pending microtask first) rather than guessing a fixed tick count.
      while (!resolveExport) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(component.busy()).toBeTrue();

      resolveExport({
        path: '/tmp/budgetmate-export-2026-07-14.csv',
        format: 'csv',
        rowCount: 3,
        byteLen: 512,
      });
      await pending;

      expect(component.busy()).toBeFalse();
      const summary = component.savedSummary();
      expect(summary?.rowCount).toBe(3);

      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Exported 3 transactions to');
      expect(host.textContent).toContain('budgetmate-export-2026-07-14.csv');
    } finally {
      restore();
    }
  });

  it('error state: a rejected export shows the plain-language error banner', async () => {
    const restore = withTauriInternals((cmd) => {
      if (cmd === 'plugin:dialog|save') return Promise.resolve('/tmp/out.csv');
      if (cmd === 'export_transactions') {
        return Promise.reject({ kind: 'internal', message: 'disk write failed' });
      }
      return Promise.resolve(null);
    });
    try {
      const fixture = createFixture();
      fixture.detectChanges();
      const component = fixture.componentInstance as unknown as {
        error: { (): string | null };
        export(): Promise<void>;
      };

      await component.export();

      expect(component.error()).not.toBeNull();
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelectorAll('app-banner').length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });
});
