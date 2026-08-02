import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  LucidePencil,
  LucideChevronUp,
  LucideChevronDown,
  LucidePlay,
  LucidePause,
} from '@lucide/angular';
import {
  listRules,
  setRuleActive,
  reorderRules,
  previewRules,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { ImportRule, RulePreview } from '../../core/models';
import { Fab } from '../../shared/ui/fab/fab';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Card } from '../../shared/ui/card/card';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

/**
 * Rule-engine management (FR-2.3): ordered if-then rules applied at import and on manual entry.
 * Fully inspectable - the list shows each rule in precedence order, and the "Test" box shows exactly
 * which rule sets which field (no hidden ML). Add/Edit are full-screen pages
 * (`settings/rules/new`, `settings/rules/:id/edit`) - the row's edit button and the Add button
 * navigate there; this component never owns a form or a modal. Evaluation/persistence live in Rust.
 */
@Component({
  selector: 'app-rules',
  imports: [
    LucidePencil,
    LucideChevronUp,
    LucideChevronDown,
    LucidePlay,
    LucidePause,
    Fab,
    IconButton,
    Card,
    Banner,
    EmptyState,
    ListRow,
    Skeleton,
  ],
  templateUrl: './rules.html',
  styleUrl: './rules.scss',
})
export class Rules implements OnInit {
  private readonly router = inject(Router);
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3];

  protected readonly rules = signal<ImportRule[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  // Inspectable preview: type a sample merchant, see the resulting fields + which rules fired.
  protected readonly testMerchant = signal('');
  protected readonly preview = signal<RulePreview | null>(null);

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

  protected ruleText(r: ImportRule): string {
    return `If ${r.matchField} ${r.matchOp} “${r.matchValue}”`;
  }
  protected ruleEffect(r: ImportRule): string {
    return `→ ${r.setField} = “${r.setValue}”${r.active ? '' : ' · disabled'}`;
  }

  protected addRule(): void {
    void this.router.navigate(['/settings/rules/new']);
  }

  /** Open the edit page, handing the row over via router state (fast path; the page refetches). */
  protected editRule(r: ImportRule): void {
    void this.router.navigate(['/settings/rules', r.id, 'edit'], { state: { rule: r } });
  }

  protected async toggleActive(r: ImportRule): Promise<void> {
    await this.mutate(() => setRuleActive(r.id, !r.active));
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
