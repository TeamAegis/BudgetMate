import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  LucidePlus,
  LucidePencil,
  LucideTrash2,
  LucideChevronUp,
  LucideChevronDown,
  LucidePlay,
  LucidePause,
} from '@lucide/angular';
import {
  listRules,
  createRule,
  updateRule,
  setRuleActive,
  deleteRule,
  reorderRules,
  previewRules,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { ImportRule, MatchOp, RuleField, RulePreview } from '../../core/models';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Card } from '../../shared/ui/card/card';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { FormField } from '../../shared/ui/form-field/form-field';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Modal } from '../../shared/ui/modal/modal';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const FIELDS: RuleField[] = ['merchant', 'category', 'account'];
const OPS: MatchOp[] = ['contains', 'equals'];

/**
 * Rule-engine management (FR-2.3): ordered if-then rules applied at import and on manual entry.
 * Fully inspectable — list shows each rule in precedence order, and the "Test" box shows exactly
 * which rule sets which field (no hidden ML). Evaluation/persistence all live in Rust.
 */
@Component({
  selector: 'app-rules',
  imports: [
    ReactiveFormsModule,
    LucidePlus,
    LucidePencil,
    LucideTrash2,
    LucideChevronUp,
    LucideChevronDown,
    LucidePlay,
    LucidePause,
    Button,
    IconButton,
    Card,
    Banner,
    EmptyState,
    ListRow,
    FormField,
    Skeleton,
    Modal,
    ConfirmDialog,
    SelectField,
  ],
  templateUrl: './rules.html',
  styleUrl: './rules.scss',
})
export class Rules implements OnInit {
  private readonly fb = inject(FormBuilder);
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3];

  /** Themed-dropdown options for the rule builder (rule fields/operators are fixed enums). */
  protected readonly fieldOptions: SelectOption[] = FIELDS.map((f) => ({ value: f, label: f }));
  protected readonly opOptions: SelectOption[] = OPS.map((o) => ({ value: o, label: o }));
  protected readonly rules = signal<ImportRule[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);
  protected readonly editing = computed(() => this.editingId() !== null);
  protected readonly confirmingDelete = signal(false);

  // Inspectable preview: type a sample merchant, see the resulting fields + which rules fired.
  protected readonly testMerchant = signal('');
  protected readonly preview = signal<RulePreview | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    matchField: this.fb.nonNullable.control<RuleField>('merchant', Validators.required),
    matchOp: this.fb.nonNullable.control<MatchOp>('contains', Validators.required),
    matchValue: ['', Validators.required],
    setField: this.fb.nonNullable.control<RuleField>('category', Validators.required),
    setValue: ['', Validators.required],
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage rules.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.rules.set(await listRules());
      await this.runPreview();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  // ── Inline validation messages (A9) — shown only when invalid AND touched. ──
  protected matchValueError(): string | null {
    const c = this.form.controls.matchValue;
    return c.invalid && c.touched ? 'Enter a value to match, e.g. uber.' : null;
  }
  protected setValueError(): string | null {
    const c = this.form.controls.setValue;
    return c.invalid && c.touched ? 'Enter a value to set, e.g. Transport.' : null;
  }

  protected ruleText(r: ImportRule): string {
    return `If ${r.matchField} ${r.matchOp} “${r.matchValue}”`;
  }
  protected ruleEffect(r: ImportRule): string {
    return `→ ${r.setField} = “${r.setValue}”${r.active ? '' : ' · disabled'}`;
  }

  protected startCreate(): void {
    this.editingId.set(null);
    this.form.reset({
      matchField: 'merchant',
      matchOp: 'contains',
      matchValue: '',
      setField: 'category',
      setValue: '',
    });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected startEdit(r: ImportRule): void {
    this.editingId.set(r.id);
    this.form.reset({
      matchField: r.matchField,
      matchOp: r.matchOp,
      matchValue: r.matchValue,
      setField: r.setField,
      setValue: r.setValue,
    });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected cancel(): void {
    this.showForm.set(false);
    this.confirmingDelete.set(false);
    this.error.set(null);
  }

  /** Bind a SelectField's emitted value back onto a form control (custom listbox → reactive form). */
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
      else {
        const existing = this.rules().find((r) => r.id === id);
        await updateRule({ id, ...v, active: existing?.active ?? true });
      }
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleActive(r: ImportRule): Promise<void> {
    await this.mutate(() => setRuleActive(r.id, !r.active));
  }

  /** Delete the rule currently open in the edit modal (after footer-trash confirmation). */
  protected async deleteConfirmed(): Promise<void> {
    const id = this.editingId();
    if (id === null) return;
    await this.mutate(() => deleteRule(id));
    this.confirmingDelete.set(false);
    this.showForm.set(false);
  }

  protected moveUp(i: number): void {
    if (i > 0) void this.swap(i, i - 1);
  }
  protected moveDown(i: number): void {
    if (i < this.rules().length - 1) void this.swap(i, i + 1);
  }

  private async swap(a: number, b: number): Promise<void> {
    const ids = this.rules().map((r) => r.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    await this.mutate(async () => {
      this.rules.set(await reorderRules(ids));
    });
  }

  /** Run a side-effecting bridge call, then refresh the list + preview. */
  private async mutate(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
      this.rules.set(await listRules());
      await this.runPreview();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async onTestInput(value: string): Promise<void> {
    this.testMerchant.set(value);
    await this.runPreview();
  }

  private async runPreview(): Promise<void> {
    const merchant = this.testMerchant().trim();
    if (!isTauri() || !merchant) {
      this.preview.set(null);
      return;
    }
    try {
      this.preview.set(await previewRules({ merchant }));
    } catch {
      this.preview.set(null);
    }
  }
}
