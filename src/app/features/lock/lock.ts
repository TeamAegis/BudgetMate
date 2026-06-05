import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideShieldCheck, LucideFingerprint, LucideEye, LucideEyeOff } from '@lucide/angular';
import { LockService } from '../../core/lock/lock.service';
import { isTauri } from '../../core/bridge';
import { Button } from '../../shared/ui/button/button';
import { Banner } from '../../shared/ui/banner/banner';
import { Card } from '../../shared/ui/card/card';
import { FormField } from '../../shared/ui/form-field/form-field';

/**
 * Lock screen (FR-5.1 / FR-5.2) — one component, two variants chosen by vault state:
 *  - **setup** (first run, no passphrase yet): set + confirm a passphrase that derives the DB key.
 *  - **unlock** (initialized): passphrase entry, with a biometric option where available (Android).
 * Built to the design system: tokens only, Lucide icons, the five states (the screen itself is the
 * "locked" state; busy/error are handled inline). No DB-backed call runs here beyond unlock itself.
 */
@Component({
  selector: 'app-lock',
  imports: [
    ReactiveFormsModule,
    LucideShieldCheck,
    LucideFingerprint,
    LucideEye,
    LucideEyeOff,
    Button,
    Banner,
    Card,
    FormField,
  ],
  template: `
    <section class="lock">
      <div class="brand-mark" aria-hidden="true">
        <svg lucideShieldCheck [size]="40"></svg>
      </div>
      <h1>{{ setup() ? 'Create your passphrase' : 'Unlock BudgetMate' }}</h1>
      <p class="muted">
        {{
          setup()
            ? 'This passphrase encrypts everything on this device. There is no recovery if you forget it.'
            : 'Enter your passphrase to decrypt your data.'
        }}
      </p>

      @if (!tauri) {
        <app-banner>Run the app (npm run tauri dev) to set up the vault.</app-banner>
      } @else {
        @if (error(); as err) {
          <app-banner>{{ err }}</app-banner>
        }
        <app-card class="form-card">
          <form class="form" [formGroup]="form" (ngSubmit)="submit()">
            <app-form-field label="Passphrase">
              <input
                [type]="reveal() ? 'text' : 'password'"
                formControlName="passphrase"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
              />
            </app-form-field>
            @if (setup()) {
              <app-form-field label="Confirm passphrase" hint="Minimum 8 characters.">
                <input
                  [type]="reveal() ? 'text' : 'password'"
                  formControlName="confirm"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
              </app-form-field>
            }
            <button
              type="button"
              class="reveal"
              (click)="reveal.set(!reveal())"
              [attr.aria-pressed]="reveal()"
            >
              @if (reveal()) {
                <svg lucideEyeOff [size]="16"></svg>
                <span>Hide passphrase</span>
              } @else {
                <svg lucideEye [size]="16"></svg>
                <span>Show passphrase</span>
              }
            </button>
            <div class="actions">
              <app-button type="submit" variant="primary" [block]="true" [disabled]="busy()">
                {{ busy() ? 'Please wait…' : setup() ? 'Create & unlock' : 'Unlock' }}
              </app-button>
            </div>
          </form>
        </app-card>

        @if (!setup() && biometricAvailable()) {
          <app-button
            variant="ghost"
            class="biometric"
            [block]="true"
            (click)="biometric()"
            [disabled]="busy()"
          >
            <svg icon lucideFingerprint [size]="20"></svg>
            <span>Use biometrics</span>
          </app-button>
        }
      }
    </section>
  `,
  styleUrl: './lock.scss',
})
export class Lock {
  private readonly fb = inject(FormBuilder);
  private readonly lock = inject(LockService);
  private readonly router = inject(Router);

  protected readonly tauri = isTauri();
  protected readonly setup = computed(() => !this.lock.initialized());
  protected readonly biometricAvailable = this.lock.biometricAvailable;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly reveal = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    passphrase: ['', [Validators.required, Validators.minLength(8)]],
    confirm: [''],
  });

  protected async submit(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { passphrase, confirm } = this.form.getRawValue();
    if (this.setup() && passphrase !== confirm) {
      this.error.set('Passphrases do not match.');
      return;
    }
    this.busy.set(true);
    try {
      if (this.setup()) {
        await this.lock.setPassphrase(passphrase);
      } else {
        await this.lock.unlock(passphrase);
      }
      await this.router.navigate(['/home']);
    } catch (e) {
      // Unlock failures are reported generically (no wrong-key oracle); setup surfaces validation.
      this.error.set(this.setup() ? String(e) : 'Incorrect passphrase. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async biometric(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.lock.unlockWithBiometric();
      await this.router.navigate(['/home']);
    } catch {
      this.error.set('Biometric unlock is unavailable. Please use your passphrase.');
    } finally {
      this.busy.set(false);
    }
  }
}
