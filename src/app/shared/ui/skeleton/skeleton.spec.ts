import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Skeleton } from './skeleton';

@Component({
  imports: [Skeleton],
  template: `<app-skeleton [variant]="variant" [lines]="lines" [size]="size" />`,
})
class Host {
  variant: 'text' | 'block' | 'circle' = 'text';
  lines = 1;
  size = 40;
}

describe('Skeleton', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('renders one pulsing bone by default', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const bones = fixture.nativeElement.querySelectorAll('.bone.anim-skeleton-pulse');
    expect(bones.length).toBe(1);
  });

  it('renders one bone per line for the text variant', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.lines = 3;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.bone').length).toBe(3);
  });

  it('renders a circular bone for the circle variant', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.variant = 'circle';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bone.circle')).toBeTruthy();
  });

  it('is hidden from assistive tech and marks itself busy', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector('app-skeleton');
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.getAttribute('aria-busy')).toBe('true');
  });
});
