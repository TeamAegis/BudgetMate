import { TestBed } from '@angular/core/testing';
import { GoalProgressRow } from './goal-progress-row';

describe('GoalProgressRow', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [GoalProgressRow] }).compileComponents();
  });

  function make(currentMinor: number, targetMinor: number, completed = false) {
    const fixture = TestBed.createComponent(GoalProgressRow);
    fixture.componentRef.setInput('name', 'Vacation');
    fixture.componentRef.setInput('currentMinor', currentMinor);
    fixture.componentRef.setInput('targetMinor', targetMinor);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.componentRef.setInput('completed', completed);
    fixture.detectChanges();
    return fixture;
  }

  it('clamps the fill fraction to 0-100', () => {
    expect(make(500_000, 1_000_000).componentInstance['percent']()).toBe(50);
    expect(make(0, 1_000_000).componentInstance['percent']()).toBe(0);
    // Over-saved goals never exceed a full bar.
    expect(make(2_000_000, 1_000_000).componentInstance['percent']()).toBe(100);
    // Guard against divide-by-zero (Rust rejects target<=0, but the view must not NaN).
    expect(make(10, 0).componentInstance['percent']()).toBe(0);
  });

  it('marks the row completed with a check icon and strikethrough title', () => {
    const fixture = make(1_000_000, 1_000_000, true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.check')).toBeTruthy();
    expect(el.querySelector('.name.done')).toBeTruthy();
  });

  it('emits edit when the row is activated', () => {
    const fixture = make(100, 1_000);
    const spy = jasmine.createSpy('edit');
    fixture.componentInstance.edit.subscribe(spy);
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    expect(spy).toHaveBeenCalled();
  });
});
