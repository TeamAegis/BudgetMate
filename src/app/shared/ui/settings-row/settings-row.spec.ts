import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { SettingsRow } from './settings-row';

@Component({
  imports: [SettingsRow],
  template: `<div app-settings-row label="Base currency" hint="Reports add up in this" [tone]="tone">
    <span icon>I</span>
    <span trailing>MUR</span>
  </div>`,
})
class Host {
  tone: 'default' | 'income' = 'default';
}

describe('SettingsRow', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('renders the label, hint, and projected icon + trailing content', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement;
    expect(host.querySelector('.srow-label').textContent).toContain('Base currency');
    expect(host.querySelector('.srow-hint').textContent).toContain('Reports add up in this');
    expect(host.querySelector('.srow-icon').textContent).toContain('I');
    expect(host.querySelector('.srow-trailing').textContent).toContain('MUR');
  });

  it('tints the icon for the income tone', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.srow-icon.income')).toBeNull();
    fixture.componentInstance.tone = 'income';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.srow-icon.income')).not.toBeNull();
  });
});
