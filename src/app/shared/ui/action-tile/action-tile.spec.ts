import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ActionTile } from './action-tile';

@Component({
  imports: [ActionTile],
  template: `<a app-action-tile label="Add expense"><span icon>+</span></a>`,
})
class Host {}

describe('ActionTile', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('renders the label and the projected glyph', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement;
    expect(host.querySelector('.tile-label').textContent).toContain('Add expense');
    expect(host.querySelector('.tile-glyph').textContent).toContain('+');
  });
});
