import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { ImportRule, MatchOp, RuleField } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const FIELDS: RuleField[] = ['merchant', 'category', 'account'];
const OPS: MatchOp[] = ['contains', 'equals'];

/**
 * Full-screen Add/Edit Rule page (FR-2.3). Replaces the former centred modal: a pushed route
 * (`settings/rules/new`, `settings/rules/:id/edit`) with Save in the app header (so the Android soft
 * keyboard can never hide it) and the back arrow as Cancel. Smart component - it builds an if-then
 * rule and persists it through the bridge; all evaluation/persistence lives in Rust. The list screen
 * keeps the precedence/reorder/toggle/test affordances; this page only edits one rule.
 */
@Component({
  selector: 'app-rule-form',
  imports: [
    ReactiveFormsModule,
    Banner,
    Spinner,
    FormField,
    FormActions,
    ConfirmDialog,
    SelectField,
  ],
  templateUrl: './rule-form.html',
  styleUrl: './rule-form.scss',
})
export class RuleForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);

  /** Rule handed over via router state at construction (consumed once; refetched on edit if absent). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedRule =
    (this.nav?.extras.state?.['rule'] as ImportRule | undefined) ?? null;

  /** The loaded rule on the edit route - needed so update() can preserve `active`. */
  private existing: ImportRule | null = null;

  /** Edit id from the route (`settings/rules/:id/edit`); null on the add route. */
  protected readonly editingId = signal<number | null>(
    this.route.snapshot.paramMap.has('id')
      ? Number(this.route.snapshot.paramMap.get('id'))
      : null,
  );
  protected readonly editing = computed(() => this.editingId() !== null);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  /** Themed-dropdown options for the rule builder (rule fields/operators are fixed enums). */
  protected readonly fieldOptions: SelectOption[] = FIELDS.map((f) => ({ value: f, label: f }));
  protected readonly opOptions: SelectOption[] = OPS.map((o) => ({ value: o, label: o }));

  protected readonly form = this.fb.nonNullable.group({
    matchField: this.fb.nonNullable.control<RuleField>('merchant', Validators.required),
    matchOp: this.fb.nonNullable.control<MatchOp>('contains', Validators.required),
    matchValue: ['', Validators.required],
    setField: this.fb.nonNullable.control<RuleField>('category', Validators.required),
    setValue: ['', Validators.required],
  });

  constructor() {
    // Edit pages expose Delete as a danger icon top-right in the header; Save is the bottom action
    // bar (FormActions) and the back arrow is Cancel. Add pages carry no header action. Cleared on
    // teardown so it never leaks onto the next screen.
    effect(() => {
      this.headerAction.set(
        this.editing()
          ? { label: 'Delete rule', icon: 'trash', run: () => this.confirmingDelete.set(true) }
          : null,
      );
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  // -- Inline validation messages (shown only when invalid AND touched) ---------------

  protected matchValueError(): string | null {
    const c = this.form.controls.matchValue;
    return c.invalid && c.touched ? 'Enter a value to match, e.g. uber.' : null;
  }
  protected setValueError(): string | null {
    const c = this.form.controls.setValue;
    return c.invalid && c.touched ? 'Enter a value to set, e.g. Transport.' : null;
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage rules.');
      return;
    }
    try {
      const id = this.editingId();
      if (id !== null) {
        const rule = this.passedRule ?? (await listRules()).find((r) => r.id === id) ?? null;
        if (!rule) {
          this.error.set('That rule could not be found.');
        } else {
          this.existing = rule;
          this.patchFromRule(rule);
        }
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private patchFromRule(r: ImportRule): void {
    this.form.reset({
      matchField: r.matchField,
      matchOp: r.matchOp,
      matchValue: r.matchValue,
      setField: r.setField,
      setValue: r.setValue,
    });
  }

  /** Bind a SelectField's emitted value back onto a form control (custom listbox -> reactive form). */
  protected setMatchField(v: number | string): void {
    this.form.controls.matchField.setValue(v as RuleField);
  }
  protected setMatchOp(v: number | string): void {
    this.form.controls.matchOp.setValue(v as MatchOp);
  }
  protected setSetField(v: number | string): void {
    this.form.controls.setField.setValue(v as RuleField);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      const id = this.editingId();
      if (id === null) await createRule({ ...v, active: true });
      else await updateRule({ id, ...v, active: this.existing?.active ?? true });
      await this.router.navigate(['/settings/rules']);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteConfirmed(): Promise<void> {
    const id = this.editingId();
    if (id === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await deleteRule(id);
      await this.router.navigate(['/settings/rules']);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingDelete.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
