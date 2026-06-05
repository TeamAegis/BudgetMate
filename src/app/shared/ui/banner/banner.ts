import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Inline status banner. `role="alert"` is baked in so consumers can't forget it. The message is
 * projected. Only the `error` tone is needed today; the input keeps room for warning/success
 * (design-system.md §7) without changing the call sites.
 *
 *   @if (error(); as err) { <app-banner>{{ err }}</app-banner> }
 */
@Component({
  selector: 'app-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="banner" [class.error]="tone() === 'error'" role="alert">
      <ng-content></ng-content>
    </p>
  `,
  styleUrl: './banner.scss',
})
export class Banner {
  readonly tone = input<'error'>('error');
}
