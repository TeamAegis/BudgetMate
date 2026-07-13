import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LucideShieldCheck } from '@lucide/angular';

/**
 * A small, persistent trust/reassurance note - static informational copy, not a live region and
 * not an alert (contrast `app-banner`, which is for transient success/warning/error feedback).
 * Pairs a decorative Lucide icon with plain-language reassurance copy; the icon carries no meaning
 * on its own (`aria-hidden`) - the text does all the work (design.md a11y: never colour/icon-alone).
 *
 *   <app-privacy-note />
 */
@Component({
  selector: 'app-privacy-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideShieldCheck],
  template: `
    <p class="privacy-note">
      <svg lucideShieldCheck class="icon" [size]="20" aria-hidden="true"></svg>
      <span class="msg">Your data is encrypted on this device. Nothing leaves your phone. No analytics.</span>
    </p>
  `,
  styleUrl: './privacy-note.scss',
})
export class PrivacyNote {}
