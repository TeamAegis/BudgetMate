import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject } from '@angular/core';

/**
 * Tracks the on-screen keyboard inset via the `visualViewport` API and publishes it as the
 * `--keyboard-inset` CSS custom property on `<html>`.
 *
 * Why: on Android WebView the keyboard does **not** resize the WebView the way desktop browsers
 * do, so fixed/pinned bottom UI (modal footers, the bottom nav) would hide behind it; and
 * `env(safe-area-inset-*)` is unreliable there (returns 0 on older Chromium / edge-to-edge mode).
 * See `.claude/rules/android.md`. Layout reads `var(--keyboard-inset)` to lift bottom-anchored
 * content. Verify on a real device - desktop WebView2 won't exercise this path.
 *
 * Idempotent; listeners run outside Angular (they only mutate a CSS variable, never app state).
 */
@Injectable({ providedIn: 'root' })
export class ViewportInsetsService {
  private readonly doc = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private started = false;

  start(): void {
    if (this.started) return;
    const win = this.doc.defaultView;
    const vv = win?.visualViewport;
    // No visualViewport (old WebView / test env): leave the CSS env() fallback in place.
    if (!win || !vv) return;
    this.started = true;

    const update = (): void => {
      // The portion of the layout viewport hidden below the visual viewport - i.e. the keyboard
      // (plus any bottom system UI the visual viewport excludes). Clamp to ≥0.
      const inset = Math.max(0, win.innerHeight - vv.height - vv.offsetTop);
      this.doc.documentElement.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
    };

    this.zone.runOutsideAngular(() => {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      update();
    });
  }
}
