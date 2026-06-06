import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';

/**
 * Labelled form field. The reactive-forms control is **projected** so `formControlName` stays on
 * the consumer's own `<input>`/`<select>` (which remains a DOM descendant of the consumer's
 * `<form [formGroup]>`, so the control binds through DI exactly as before):
 *
 *   <app-form-field label="Currency" hint="3-letter ISO code, e.g. MUR">
 *     <input type="text" formControlName="currency" maxlength="3" class="numeric" />
 *   </app-form-field>
 *
 * Uses `ViewEncapsulation.None` because the projected control must be styled by this component;
 * every rule is scoped under the host `.form-field` class so nothing leaks globally.
 */
@Component({
  selector: 'app-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'form-field' },
  template: `
    <!-- The control is projected into this wrapping label (implicit association); the linter
         can't see the projected <input>/<select>, so the rule is disabled here. -->
    <!-- eslint-disable-next-line @angular-eslint/template/label-has-associated-control -->
    <label>
      <span>{{ label() }}</span>
      <ng-content></ng-content>
      @if (hint(); as h) {
        <small class="hint">{{ h }}</small>
      }
    </label>
  `,
  styleUrl: './form-field.scss',
})
export class FormField {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
}
