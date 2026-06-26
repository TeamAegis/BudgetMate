import { HeaderActionService } from './header-action.service';

describe('HeaderActionService', () => {
  it('starts with no action', () => {
    const svc = new HeaderActionService();
    expect(svc.action()).toBeNull();
  });

  it('publishes an action and clears it', () => {
    const svc = new HeaderActionService();
    let ran = 0;
    svc.set({ label: 'Save', loading: false, run: () => (ran = ran + 1) });

    const action = svc.action();
    expect(action?.label).toBe('Save');
    action?.run();
    expect(ran).toBe(1);

    svc.clear();
    expect(svc.action()).toBeNull();
  });
});
