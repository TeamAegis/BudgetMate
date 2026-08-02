import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FabMenu, type FabMenuItem } from './fab-menu';

@Component({
  imports: [FabMenu],
  template: `<app-fab-menu
    ariaLabel="Add a transaction or scan a receipt"
    [items]="items"
    (selected)="picked = $event"
  />`,
})
class Host {
  items: FabMenuItem[] = [
    { id: 'add', label: 'Add expense', icon: 'plus' },
    { id: 'scan', label: 'Scan receipt', icon: 'scan' },
  ];
  picked: string | null = null;
}

describe('FabMenu', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('starts closed with an accessible, collapsed trigger', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const trigger: HTMLElement = fixture.nativeElement.querySelector('.fab');
    expect(trigger.getAttribute('aria-label')).toBe('Add a transaction or scan a receipt');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelectorAll('.fab-item').length).toBe(0);
  });

  it('opens on tap and renders one labelled item per input', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const trigger: HTMLElement = fixture.nativeElement.querySelector('.fab');
    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = fixture.nativeElement.querySelectorAll('.fab-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Add expense');
    expect(items[1].textContent).toContain('Scan receipt');
  });

  it('emits the chosen id and closes', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.fab').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelectorAll('.fab-item')[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toBe('scan');
    expect(fixture.nativeElement.querySelectorAll('.fab-item').length).toBe(0);
  });

  it('closes on Escape', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const trigger: HTMLElement = fixture.nativeElement.querySelector('.fab');
    trigger.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.fab-item').length).toBe(2);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.fab-item').length).toBe(0);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders a glyph for every supported icon, including allowance and budget', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.items = [
      { id: 'add', label: 'Add expense', icon: 'plus' },
      { id: 'scan', label: 'Scan receipt', icon: 'scan' },
      { id: 'file', label: 'Import a file', icon: 'import' },
      { id: 'goal', label: 'Add goal', icon: 'goal' },
      { id: 'allowance', label: 'Add allowance', icon: 'allowance' },
      { id: 'budget', label: 'Add budget', icon: 'budget' },
    ];
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.fab').click();
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.fab-item');
    expect(items.length).toBe(6);
    // Every icon in the union must resolve to a rendered glyph - a missing @switch arm would leave
    // the label with no icon beside it rather than failing the build.
    for (const item of Array.from(items) as HTMLElement[]) {
      expect(item.querySelector('.fab-item-glyph svg')).not.toBeNull();
    }
    expect(items[4].textContent).toContain('Add allowance');
    expect(items[5].textContent).toContain('Add budget');
  });
});
