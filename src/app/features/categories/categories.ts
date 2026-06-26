import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucidePencil, LucidePlus } from '@lucide/angular';
import { listCategories, toUserMessage, isTauri } from '../../core/bridge';
import type { Category } from '../../core/models';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

/**
 * Category list. Smart component: reads categories through the bridge and renders with shared/ui.
 * Add/Edit are full-screen pages (`settings/categories/new`, `settings/categories/:id/edit`) - the
 * Add button, the empty-state CTA, and each row's edit button navigate there; this component never
 * owns a form or a modal.
 */
@Component({
  selector: 'app-categories',
  imports: [LucidePencil, LucidePlus, Button, IconButton, Banner, EmptyState, ListRow, Skeleton],
  templateUrl: './categories.html',
  styleUrl: './categories.scss',
})
export class Categories implements OnInit {
  private readonly router = inject(Router);
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3];
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
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
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected parentName(id: number | null): string {
    if (id === null) return '-';
    return this.categories().find((c) => c.id === id)?.name ?? '-';
  }

  protected addCategory(): void {
    void this.router.navigate(['/settings/categories/new']);
  }

  /** Open the edit page, handing the row over via router state (fast path; refresh refetches). */
  protected editCategory(c: Category): void {
    void this.router.navigate(['/settings/categories', c.id, 'edit'], { state: { category: c } });
  }
}
