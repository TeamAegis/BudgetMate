import { TestBed } from '@angular/core/testing';
import { NavTabService } from './nav-tab.service';

describe('NavTabService', () => {
  let service: NavTabService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NavTabService);
  });

  it('starts with no tab selected', () => {
    expect(service.activeTab()).toBeNull();
  });

  it('lights the tab root that matches the first URL segment', () => {
    service.sync(undefined, '/home');
    expect(service.activeTab()).toBe('home');

    service.sync(undefined, '/analytics');
    expect(service.activeTab()).toBe('analytics');
  });

  it('keeps the tab lit on a pushed child route of that tab', () => {
    service.sync(undefined, '/expenses/5/edit');
    expect(service.activeTab()).toBe('expenses');

    service.sync(undefined, '/goals/new');
    expect(service.activeTab()).toBe('goals');
  });

  it('maps the nested action areas to their owning tab (the bug: nothing was lit)', () => {
    for (const url of ['/settings', '/settings/rules/new', '/budgets', '/allowances/3/edit']) {
      service.sync(undefined, url);
      expect(service.activeTab()).toBe('home', `expected home for ${url}`);
    }
    // Import produces transactions, so it belongs to Expenses.
    service.sync(undefined, '/import/file');
    expect(service.activeTab()).toBe('expenses');
  });

  it('lets an explicit route data.tab override the URL-derived owner', () => {
    service.sync('expenses', '/settings/rules');
    expect(service.activeTab()).toBe('expenses');
  });

  it('ignores an unrecognised data.tab and falls back to the URL', () => {
    service.sync('not-a-tab', '/budgets');
    expect(service.activeTab()).toBe('home');
    service.sync(42, '/goals');
    expect(service.activeTab()).toBe('goals');
  });

  it('selects no tab for unowned routes, so the lock screens stay clean', () => {
    service.sync(undefined, '/unlock');
    expect(service.activeTab()).toBeNull();
    service.sync(undefined, '/');
    expect(service.activeTab()).toBeNull();
  });

  it('tolerates query strings and fragments', () => {
    service.sync(undefined, '/expenses?filter=month#top');
    expect(service.activeTab()).toBe('expenses');
  });
});
