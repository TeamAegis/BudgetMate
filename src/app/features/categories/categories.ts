import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideArchive, LucidePencil, LucidePlus } from '@lucide/angular';
import {
  listCategories,
  createCategory,
  updateCategory,
  archiveCategory,
  isTauri,
} from '../../core/bridge';
import type { Category, CategoryKind } from '../../core/models';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { FormField } from '../../shared/ui/form-field/form-field';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Modal } from '../../shared/ui/modal/modal';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const KINDS: CategoryKind[] = ['expense', 'income', 'transfer'];
/** Sentinel SelectField value for "no parent" (option values can't be null). */
const NO_PARENT = '';

@Component({
  selector: 'app-categories',
  imports: [
    ReactiveFormsModule,
    LucideArchive,
    LucidePencil,
    LucidePlus,
    Button,
    IconButton,
    Banner,
    EmptyState,
    ListRow,
    FormField,
    Skeleton,
    Modal,
    SelectField,
  ],
  templateUrl: './categories.html',
  styleUrl: './categories.scss',
})
export class Categories implements OnInit {
  private readonly fb = inject(FormBuilder);
  /** Themed-dropdown options for the category kind (native <select> can't be styled in the WebView). */
  protected readonly kindOptions: SelectOption[] = KINDS.map((k) => ({ value: k, label: k }));
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3];
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);
  protected readonly editing = computed(() => this.editingId() !== null);

  /** Candidate parents = "None" + all categories except the one being edited (backend rejects cycles). */
  protected readonly parentOptions = computed<SelectOption[]>(() => [
    { value: NO_PARENT, label: '— None —' },
    ...this.categories()
      .filter((c) => c.id !== this.editingId())
      .map((c) => ({ value: c.id, label: c.name })),
  ]);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    kind: ['expense' as CategoryKind, Validators.required],
    parentId: [null as number | null],
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  protected parentName(id: number | null): string {
    if (id === null) return '—';
    return this.categories().find((c) => c.id === id)?.name ?? '—';
  }

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage categories.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.categories.set(await listCategories(false));
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected startCreate(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', kind: 'expense', parentId: null });
    this.showForm.set(true);
  }

  protected startEdit(c: Category): void {
    this.editingId.set(c.id);
    this.form.reset({ name: c.name, kind: c.kind, parentId: c.parentId });
    this.showForm.set(true);
  }

  protected cancel(): void {
    this.showForm.set(false);
    this.error.set(null);
  }

  /** Bind SelectField values back onto the form (custom listbox → reactive form). */
  protected setKind(v: number | string): void {
    this.form.controls.kind.setValue(v as CategoryKind);
  }
  protected setParent(v: number | string): void {
    this.form.controls.parentId.setValue(v === NO_PARENT ? null : Number(v));
  }
  /** Current parent as a SelectField value (null → the "None" sentinel). */
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
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async archive(c: Category): Promise<void> {
    this.busy.set(true);
    try {
      await archiveCategory(c.id);
      await this.reload();
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
