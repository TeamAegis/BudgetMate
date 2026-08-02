import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NavDrawer, type NavDrawerGroup } from './nav-drawer';
import { MONEY_DESTINATIONS, GENERAL_DESTINATIONS } from '../../../core/layout/nav-destinations';

@Component({
  imports: [NavDrawer],
  template: `<app-nav-drawer [groups]="groups" (dismiss)="dismissed = dismissed + 1" />`,
})
class Host {
  groups: NavDrawerGroup[] = [
    { title: 'Your money', items: MONEY_DESTINATIONS },
    { title: 'General', items: GENERAL_DESTINATIONS },
  ];
  dismissed = 0;
}

describe('NavDrawer', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders a labelled modal sheet with one row per destination', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const sheet: HTMLElement = fixture.nativeElement.querySelector('.drawer-sheet');

    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    // Labelled by its own heading, so a screen reader announces the sheet.
    const titleId = sheet.getAttribute('aria-labelledby');
    expect(fixture.nativeElement.querySelector(`#${titleId}`)).not.toBeNull();

    const rows = fixture.nativeElement.querySelectorAll('.drawer-row');
    expect(rows.length).toBe(MONEY_DESTINATIONS.length + GENERAL_DESTINATIONS.length);
  });

  it('shows every destination label and hint as text (never an icon alone)', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;

    for (const item of [...MONEY_DESTINATIONS, ...GENERAL_DESTINATIONS]) {
      expect(text).withContext(item.label).toContain(item.label);
      expect(text).withContext(item.hint).toContain(item.hint);
    }
  });

  it('deliberately excludes the four primary bottom-nav tabs', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const hrefs = Array.from(host.querySelectorAll<HTMLAnchorElement>('.drawer-row')).map((a) =>
      a.getAttribute('href'),
    );

    // Hiding a PRIMARY destination behind a menu is the anti-pattern the drawer must not commit
    // (ADR 0013) - those four live in the always-visible BottomNav.
    for (const tab of ['/home', '/expenses', '/goals', '/analytics']) {
      expect(hrefs).withContext(tab).not.toContain(tab);
    }
  });

  it('dismisses on a scrim click but not on a click inside the sheet', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.componentInstance;

    fixture.nativeElement.querySelector('.drawer-sheet').click();
    expect(host.dismissed).toBe(0);

    fixture.nativeElement.querySelector('.drawer-scrim').click();
    fixture.detectChanges();
    expect(host.dismissed).toBe(1);
  });

  it('dismisses on Escape', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const sheet: HTMLElement = fixture.nativeElement.querySelector('.drawer-sheet');

    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.dismissed).toBe(1);
  });

  it('moves focus into the sheet on open and restores it on close', () => {
    // The element focused before opening (the header's menu button in the real shell).
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.drawer-row'));

    // Destroying the component is how the shell closes the drawer (existence IS open).
    fixture.destroy();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('locks background scroll while open and releases it on close', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');

    fixture.destroy();
    expect(document.body.style.overflow).toBe('');
  });
});
