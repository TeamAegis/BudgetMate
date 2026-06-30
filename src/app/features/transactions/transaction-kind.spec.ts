import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TransactionKind } from './transaction-kind';

describe('TransactionKind', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactionKind],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('offers an expense path and an income path', () => {
    const fixture = TestBed.createComponent(TransactionKind);
    fixture.detectChanges();
    const host = fixture.nativeElement;
    const hrefs = Array.from(host.querySelectorAll('a')).map((a) =>
      (a as HTMLAnchorElement).getAttribute('href'),
    );
    expect(host.textContent).toContain('Expense');
    expect(host.textContent).toContain('Income');
    expect(hrefs).toContain('/expenses/new/expense');
    expect(hrefs).toContain('/expenses/new/income');
  });
});
