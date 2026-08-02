import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  listCategories,
  createCategory,
  updateCategory,
  archiveCategory,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { Category, CategoryKind } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const KINDS: CategoryKind[] = ['expense', 'income', 'transfer'];
/** Sentinel SelectField value for "no parent" (option values can't be null). */
const NO_PARENT = '';

/**
 * Full-screen Add/Edit Category page. Replaces the former centred modal: a pushed route
 * (`settings/categories/new`, `settings/categories/:id/edit`) with Save in the app header (so the
 * Android soft keyboard can never hide it) and the back arrow as Cancel. Smart component - reads the
 * category list through the bridge (for the parent dropdown) and renders with shared/ui. All
 * validation of the category itself (cycles, kind rules) happens in Rust; TS only formats and shows
 * the inline name hint.
 */
@Component({
  selector: 'app-category-form',
  imports: [
    ReactiveFormsModule,
    Banner,
    Spinner,
    FormField,
    FormActions,
    ConfirmDialog,
    SelectField,
  ],
  templateUrl: './category-form.html',
  styleUrl: './category-form.scss',
})
export class CategoryForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);

  /** Entity handed over via router state at construction (consumed once; refresh refetches). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedCategory =
    (this.nav?.extras.state?.['category'] as Category | undefined) ?? null;

  /** Edit id from the route (`settings/categories/:id/edit`); null on the add route. */
  protected readonly editingId = signal<number | null>(
    this.route.snapshot.paramMap.has('id')
      ? Number(this.route.snapshot.paramMap.get('id'))
      : null,
  );
  protected readonly editing = computed(() => this.editingId() !== null);

  /** Themed-dropdown options for the category kind (native <select> can't be styled in the WebView). */
  /** Raw enum values never render (ux-blueprint §10) - display labels only. */
  private static readonly KIND_LABELS: Record<string, string> = {
    expense: 'Expense',
    income: 'Income',
    transfer: 'Transfer',
  };

  protected readonly kindOptions: SelectOption[] = KINDS.map((k) => ({
    value: k,
    label: CategoryForm.KIND_LABELS[k] ?? k,
  }));

  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Open the archive confirmation (A14) - archive never fires straight from the button. */
  protected readonly confirmingArchive = signal(false);

  /** Candidate parents = "None" + all categories except the one being edited (backend rejects cycles). */
  protected readonly parentOptions = computed<SelectOption[]>(() => [
    { value: NO_PARENT, label: 'None' },
    ...this.categories()
      .filter((c) => c.id !== this.editingId())
      .map((c) => ({ value: c.id, label: c.name })),
  ]);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    kind: ['expense' as CategoryKind, Validators.required],
    parentId: [null as number | null],
  });

  constructor() {
    // Edit pages expose Archive as a danger icon top-right in the header; Save is the bottom action
    // bar (FormActions) and the back arrow is Cancel. Add pages carry no header action. Cleared on
    // teardown so it never leaks onto the next screen.
    effect(() => {
      this.headerAction.set(
        this.editing()
          ? { label: 'Archive category', icon: 'archive', run: () => this.confirmingArchive.set(true) }
          : null,
      );
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to add categories.');
      return;
    }
    try {
      this.categories.set(await listCategories(false));

      const id = this.editingId();
      if (id !== null) {
        const category =
          this.passedCategory ?? this.categories().find((c) => c.id === id) ?? null;
        if (!category) {
          this.error.set('That category could not be found.');
        } else {
          this.form.reset({ name: category.name, kind: category.kind, parentId: category.parentId });
        }
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Inline validation message (A9) - shown only when invalid AND touched. */
  protected nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter a name.' : 'Name is too long (60 characters max).';
  }

  protected parentName(id: number | null): string {
    if (id === null) return '-';
    return this.categories().find((c) => c.id === id)?.name ?? '-';
  }

  /** Bind SelectField values back onto the form (custom listbox -> reactive form). */
  protected setKind(v: number | string): void {
    this.form.controls.kind.setValue(v as CategoryKind);
  }
  protected setParent(v: number | string): void {
    this.form.controls.parentId.setValue(v === NO_PARENT ? null : Number(v));
  }
  /** Current parent as a SelectField value (null -> the "None" sentinel). */
  protected parentValue(): number | string {
    return this.form.controls.parentId.value ?? NO_PARENT;
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, kind, parentId } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      const id = this.editingId();
      if (id === null) {
        await createCategory({ name, kind, parentId });
      } else {
        await updateCategory({ id, name, kind, parentId });
      }
      await this.router.navigate(['/settings/categories']);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async archiveConfirmed(): Promise<void> {
    const id = this.editingId();
    if (id === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await archiveCategory(id);
      await this.router.navigate(['/settings/categories']);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingArchive.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
