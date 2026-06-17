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
});
