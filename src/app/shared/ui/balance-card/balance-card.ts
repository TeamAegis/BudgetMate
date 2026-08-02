import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MoneyPipe } from '../../pipes/money.pipe';

/**
 * The Home hero summary card (signature coral-40 fill + offset pink shadow): a label, an optional
 * big money figure (minor units from Rust, formatted by the money pipe - never TS math), the
 * plain-language explainer for that figure, and a footer slot for the secondary figures.
 *
 * The card is deliberately SELF-CONTAINED. It used to render only label + figure, which left Home's
 * explanatory lines ("That's your whole balance...") orphaned underneath it as loose muted text and
 * pushed the secondary figures into separate cards of competing weight. Current practice for a
 * balance hero is the opposite: one contextual panel that answers "where do I stand right now"
 * completely - the headline figure PLUS what it already accounts for PLUS, at a glance, what came in
 * and went out - because that is the comparison a person actually makes when they open the app.
 * Hence `note` (inside the card, attached to the figure it explains) and the `footer` slot.
 *
 * Hierarchy is one step per level so nothing competes: uppercase caption label -> large figure ->
 * body note -> hairline rule -> small footer stats.
 *
 *   <app-balance-card label="Safe to spend" [amountMinor]="usable()" [currency]="base()"
 *                     [note]="explainer()">
 *     <div footer> …compact secondary figures… </div>
 *   </app-balance-card>
 */
@Component({
  selector: 'app-balance-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe],
  template: `
    <span class="bc-label">{{ label() }}</span>
    @if (amountMinor() !== null) {
      <span class="bc-figure numeric">{{
        { amountMinor: amountMinor()!, currency: currency() } | money
      }}</span>
    }
    @if (note(); as n) {
      <span class="bc-note">{{ n }}</span>
    }
    @if (caption(); as c) {
      <span class="bc-caption">{{ c }}</span>
    }
    <!-- Collapses to nothing when the host projects no footer (the :empty rule in the stylesheet),
         so the card keeps its tight label+figure form wherever the secondary figures aren't wanted. -->
    <div class="bc-footer"><ng-content select="[footer]"></ng-content></div>
  `,
  styleUrl: './balance-card.scss',
})
export class BalanceCard {
  readonly label = input.required<string>();
  /** Minor units (from Rust). Null renders the label + caption only (no figure). */
  readonly amountMinor = input<number | null>(null);
  readonly currency = input('MUR');
  /**
   * The plain-language explainer for the figure (e.g. what it already has set aside). Lives INSIDE
   * the card because it is meaningless apart from the figure it qualifies.
   */
  readonly note = input<string | null>(null);
  readonly caption = input<string | null>(null);
}
