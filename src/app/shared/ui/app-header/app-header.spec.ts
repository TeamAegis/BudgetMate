import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AppHeader } from './app-header';

@Component({
  imports: [AppHeader],
  template: `<app-header
    [title]="title()"
    [isBrand]="isBrand()"
    [hasBack]="hasBack()"
    [showMenu]="showMenu()"
    [menuOpen]="menuOpen()"
    (back)="backs = backs + 1"
    (menu)="menus = menus + 1"
  />`,
})
class Host {
  title = signal('BudgetMate');
  isBrand = signal(true);
  hasBack = signal(false);
  showMenu = signal(true);
  menuOpen = signal(false);
  backs = 0;
  menus = 0;
}

describe('AppHeader', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  it('shows an accessible nav-drawer button on a top-level tab', () => {
    const fixture = render();
    const menu: HTMLButtonElement = fixture.nativeElement.querySelector('.menu');

    expect(menu).not.toBeNull();
    expect(menu.getAttribute('aria-label')).toBe('Go to');
    expect(menu.getAttribute('aria-haspopup')).toBe('dialog');
    expect(menu.getAttribute('aria-expanded')).toBe('false');

    menu.click();
    expect(fixture.componentInstance.menus).toBe(1);
  });

  it('reports the drawer as expanded while it is open', () => {
    const fixture = render();
    fixture.componentInstance.menuOpen.set(true);
    fixture.detectChanges();

    const menu: HTMLElement = fixture.nativeElement.querySelector('.menu');
    expect(menu.getAttribute('aria-expanded')).toBe('true');
  });

  it('gives the leading slot to Back on a pushed screen, never the menu', () => {
    const fixture = render();
    fixture.componentInstance.hasBack.set(true);
    fixture.componentInstance.title.set('New expense');
    fixture.componentInstance.isBrand.set(false);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    // Back owns that slot (ADR 0013): a form page must never trade Back for a menu.
    expect(host.querySelector('.back')).not.toBeNull();
    expect(host.querySelector('.menu')).toBeNull();

    host.querySelector<HTMLElement>('.back')!.click();
    expect(fixture.componentInstance.backs).toBe(1);
  });

  it('omits the menu entirely when the shell does not ask for it', () => {
    const fixture = render();
    fixture.componentInstance.showMenu.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.menu')).toBeNull();
  });

  it('keeps the settings link on a tab (the trailing slot is unaffected by the menu)', () => {
    const fixture = render();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.settings-link');

    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/settings');
  });
});
