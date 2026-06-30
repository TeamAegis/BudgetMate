import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideTag, LucideChevronRight } from '@lucide/angular';
import { listCategories, toUserMessage, isTauri } from '../../core/bridge';
import type { Category, CategoryKind } from '../../core/models';
import { SettingsRow } from '../../shared/ui/settings-row/settings-row';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Banner } from '../../shared/ui/banner/banner';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

/**
 * Step 1b of adding a transaction (FR-1.1): pick a category within the chosen kind. A plain
 * navigation list (Settings style, no Save bar); each row pushes the entry form
 * (`expenses/new/:kind/:categoryId`). The picked category sets the type, so the form shows it
 * rather than re-picking it. When reached from the form's "change category" affordance the
 * in-progress entry rides along in nav state (`resume`) and is forwarded unchanged, so changing
 * the category never loses what was typed. See ADR 0004 and `docs/design/screens.md` 8.0.
 */
@Component({
  selector: 'app-category-picker',
  imports: [RouterLink, SettingsRow, EmptyState, Banner, Skeleton, LucideTag, LucideChevronRight],
  template: `
    <section class="feature-page">
      @if (error(); as err) {
        <app-banner>{{ err }}</app-banner>
      }

      @if (loading()) {
        <ul class="rows" aria-busy="true">
          @for (i of skeletonRows; track i) {
            <li class="skeleton-row"><app-skeleton variant="text" width="60%" /></li>
          }
        </ul>
      } @else if (categories().length === 0 && !error()) {
        <app-empty-state
          message="No {{ kind }} categories yet. Add one to start."
          cta="Add a category"
          (action)="addCategory()"
        />
      } @else {
        <p class="prompt">Choose a category</p>
        <ul class="rows">
          @for (cat of categories(); track cat.id; let i = $index) {
            <li
              animate.enter="list-item-enter"
              [style.animation-delay]="(i < 12 ? i * 40 : 0) + 'ms'"
            >
              <a
                app-settings-row
                [routerLink]="['/expenses/new', kind, cat.id]"
                [state]="resumeState"
                [replaceUrl]="!!resumeState"
                [label]="cat.name"
              >
                <svg icon lucideTag [size]="24" aria-hidden="true"></svg>
                <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
              </a>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .prompt {
      margin: 0;
      color: var(--c-text-muted);
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .skeleton-row {
      padding: var(--space-4);
      border: 1px solid var(--c-border);
      border-radius: var(--radius-md);
    }
  `,
})
export class CategoryPicker implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** The kind branch from the route (`expense` | `income`); anything else falls back to expense. */
  protected readonly kind: CategoryKind =
    this.route.snapshot.paramMap.get('kind') === 'income' ? 'income' : 'expense';

  /** In-progress entry forwarded from the form's "change category" tap, re-passed verbatim. */
  private readonly incomingResume =
    this.router.getCurrentNavigation()?.extras.state?.['resume'] ?? null;
  protected readonly resumeState = this.incomingResume ? { resume: this.incomingResume } : undefined;

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to add transactions.');
      return;
    }
    try {
      const cats = await listCategories(false);
      this.categories.set(
        cats.filter((c) => c.kind === this.kind).sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected addCategory(): void {
    void this.router.navigate(['/settings/categories/new']);
  }
}
