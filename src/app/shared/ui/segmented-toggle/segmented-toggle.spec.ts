import { TestBed } from '@angular/core/testing';
import { SegmentedToggle } from './segmented-toggle';

describe('SegmentedToggle', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SegmentedToggle] }).compileComponents();
  });

  function make(value = 'ongoing') {
    const fixture = TestBed.createComponent(SegmentedToggle);
    fixture.componentRef.setInput('ariaLabel', 'Goal status');
    fixture.componentRef.setInput('options', [
      { value: 'ongoing', label: 'Ongoing' },
      { value: 'completed', label: 'Completed' },
    ]);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a radiogroup and marks the active segment with aria-checked, not colour alone', () => {
    const el = make('completed').nativeElement as HTMLElement;
    expect(el.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Goal status');
    const segments = el.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(segments[0].getAttribute('aria-checked')).toBe('false');
    expect(segments[1].getAttribute('aria-checked')).toBe('true');
    expect(segments[1].classList.contains('active')).toBe(true);
    // Roving tabindex: only the active segment is reachable by Tab.
    expect(segments[0].tabIndex).toBe(-1);
    expect(segments[1].tabIndex).toBe(0);
  });

  it('updates the two-way value when a segment is clicked', () => {
    const fixture = make('ongoing');
    const segments = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[role="radio"]',
    );
    segments[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('completed');
  });

  it('moves selection with arrow keys (wrapping)', () => {
    const fixture = make('ongoing');
    const segments = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[role="radio"]',
    );
    segments[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('completed');

    // Wrap forward from the last segment back to the first.
    segments[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('ongoing');
  });

  it('is non-interactive and marked aria-disabled when disabled', () => {
    const fixture = make('ongoing');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="radiogroup"]')!.getAttribute('aria-disabled')).toBe('true');
    const segments = el.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    for (const seg of Array.from(segments)) {
      expect(seg.disabled).toBe(true);
    }

    // A click on a non-active segment must not change the value while disabled.
    segments[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('ongoing');
  });

  describe('layout', () => {
    /** Builds the two-option Kind field the allowance form uses, both options carrying a hint. */
    function makeWithHints(layout: 'pill' | 'list', value = 'recurring') {
      const fixture = TestBed.createComponent(SegmentedToggle);
      fixture.componentRef.setInput('ariaLabel', 'Recurring or one-time');
      fixture.componentRef.setInput('options', [
        { value: 'recurring', label: 'Recurring', hint: 'Refills on its own every week or month' },
        { value: 'one_time', label: 'One-time', hint: 'A single amount you set aside once' },
      ]);
      fixture.componentRef.setInput('value', value);
      fixture.componentRef.setInput('layout', layout);
      fixture.detectChanges();
      return fixture;
    }

    it('defaults to the pill treatment, so the filter usages are untouched', () => {
      const el = make('ongoing').nativeElement as HTMLElement;
      expect(el.querySelector('.seg')!.classList.contains('list')).toBe(false);
    });

    it('ignores hints in the pill layout (no room for a second line)', () => {
      const el = makeWithHints('pill').nativeElement as HTMLElement;
      expect(el.querySelector('.seg-hint')).toBeNull();
      expect(el.textContent).not.toContain('A single amount you set aside once');
    });

    it('renders stacked rows with each option hint when layout is list', () => {
      const el = makeWithHints('list').nativeElement as HTMLElement;
      expect(el.querySelector('.seg')!.classList.contains('list')).toBe(true);
      const hints = el.querySelectorAll('.seg-hint');
      expect(hints.length).toBe(2);
      expect(hints[0].textContent).toContain('Refills on its own every week or month');
      expect(hints[1].textContent).toContain('A single amount you set aside once');
    });

    it('keeps the same radiogroup contract in list layout, with a non-colour selected cue', () => {
      const el = makeWithHints('list', 'one_time').nativeElement as HTMLElement;
      expect(el.querySelector('[role="radiogroup"]')).not.toBeNull();
      const segments = el.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      expect(segments.length).toBe(2);
      expect(segments[0].getAttribute('aria-checked')).toBe('false');
      expect(segments[1].getAttribute('aria-checked')).toBe('true');
      // Selection carries a shape cue (a glyph) as well as the tint, so it never rests on colour.
      expect(segments[1].querySelector('.seg-mark svg')).not.toBeNull();
      // The glyph is decorative - the state is already announced via aria-checked.
      expect(segments[1].querySelector('.seg-mark')!.getAttribute('aria-hidden')).toBe('true');
    });

    it('still moves selection with arrow keys in list layout', () => {
      const fixture = makeWithHints('list', 'recurring');
      const segments = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      );
      segments[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      fixture.detectChanges();
      expect(fixture.componentInstance.value()).toBe('one_time');
    });
  });
});
