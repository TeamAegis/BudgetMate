import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { LucideChevronDown, LucideCheck } from '@lucide/angular';

export interface SelectOption {
  value: number | string;
  label: string;
}

/**
 * On-system single-select dropdown. Native `<select>` popups are OS-rendered and can't be themed
 * in the WebView, so this presentational listbox is built from design tokens instead. Accessible:
 * a `listbox`/`option` ARIA pattern with roving focus, full keyboard support, and click-outside +
 * Escape to dismiss. Dumb component - the parent owns the value (feature → core/bridge).
 *
 * `disabled` (default false) makes the trigger non-interactive - e.g. while an in-flight operation
 * elsewhere on the page depends on the current value staying put (the import wizard's idle-step
 * preview read, design review of issue #13). The trigger gets `[disabled]` (removing it from the
 * tab order and blocking the popup from opening) and `aria-disabled="true"`; the visual dimming
 * uses `--opacity-disabled` only, never a hardcoded value.
 */
@Component({
  selector: 'app-select-field',
  imports: [LucideChevronDown, LucideCheck],
  template: `
    <button
      type="button"
      class="trigger"
      [class.disabled]="disabled()"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown)="onTriggerKeydown($event)"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-labelledby]="ariaLabelledby()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-disabled]="disabled() ? true : null"
    >
      <span>{{ selectedLabel() }}</span>
      <svg lucideChevronDown [size]="18" class="chevron" [class.up]="open()" aria-hidden="true"></svg>
    </button>

    @if (open()) {
      <ul class="menu" role="listbox">
        @for (opt of options(); track opt.value) {
          <li role="presentation">
            <button
              #optionEl
              type="button"
              role="option"
              class="opt"
              tabindex="-1"
              [class.selected]="opt.value === value()"
              [attr.aria-selected]="opt.value === value()"
              (click)="choose(opt)"
              (keydown)="onMenuKeydown($event)"
            >
              <span>{{ opt.label }}</span>
              @if (opt.value === value()) {
                <svg lucideCheck [size]="16" aria-hidden="true"></svg>
              }
            </button>
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './select-field.scss',
})
export class SelectField {
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;

  readonly options = input.required<SelectOption[]>();
  readonly value = input<number | string | null>(null);
  readonly ariaLabelledby = input<string | undefined>(undefined);
  /** Accessible name when there is no labelledby element (e.g. inside an app-form-field). */
  readonly ariaLabel = input<string | undefined>(undefined);
  /** Makes the control non-interactive (see class doc). */
  readonly disabled = input(false);
  readonly valueChange = output<number | string>();

  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);
  private readonly optionEls = viewChildren<ElementRef<HTMLButtonElement>>('optionEl');

  protected readonly selectedLabel = computed(
    () => this.options().find((o) => o.value === this.value())?.label ?? 'Select…',
  );

  constructor() {
    // Move DOM focus to the active option whenever the menu is open / the active index moves.
    effect(() => {
      if (!this.open()) return;
      this.optionEls()[this.activeIndex()]?.nativeElement.focus();
    });
  }

  protected toggle(): void {
    if (this.disabled()) return;
    if (this.open()) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    const selected = this.options().findIndex((o) => o.value === this.value());
    this.activeIndex.set(selected >= 0 ? selected : 0);
    this.open.set(true);
  }

  private close(): void {
    this.open.set(false);
  }

  protected choose(opt: SelectOption): void {
    this.valueChange.emit(opt.value);
    this.close();
    this.focusTrigger();
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      this.openMenu();
    }
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex.update((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.update((i) => (i - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        this.activeIndex.set(0);
        break;
      case 'End':
        event.preventDefault();
        this.activeIndex.set(count - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.choose(this.options()[this.activeIndex()]);
        break;
      case 'Escape':
      case 'Tab':
        this.close();
        this.focusTrigger();
        break;
    }
  }

  private focusTrigger(): void {
    this.host.nativeElement.querySelector<HTMLButtonElement>('.trigger')?.focus();
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerDown(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }
}
