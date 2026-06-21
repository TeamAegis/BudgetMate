# Financial Literacy, Accounting & Personal Budgeting - Conceptual Domain Knowledge Base

> **What this is and how to use it.** This is a **domain reference for validation**, *not* a product
> spec or a feature backlog. v1 scope is defined solely by `docs/functional-requirements.md` - much of
> the material here (taxes, financial ratios, debt amortization, investing) is deliberately **out of
> v1 scope** and appears only so that what the app *does* build can be checked for financial
> correctness and for understandability by users with limited or no financial literacy. The
> **`finance-validator`** role (run via the **`/finance-check <FR|screen|area>`** skill) validates
> features/screens/copy against this document on two axes: *correctness* (money math, categorisation,
> MUR formatting, any figures used) and *low-literacy usability* (jargon explained, deterministic
> reasons shown, sensible defaults). Do not turn the out-of-scope sections into feature requests.
> **The Mauritius statutory figures are dated (income year 2025/26) and change annually - re-verify
> against the latest MRA / Bank of Mauritius / Statistics Mauritius publications before relying on any
> specific figure in code or user-facing copy.**

*A reference file of domain expertise for building a personal budgeting/finance application. Conceptual knowledge only - definitions, principles, formulas, frameworks, taxonomies, and best practices. No code, architecture, or implementation. Mauritius-specific content is clearly marked (MU). Figures current to the 2025/2026 Mauritius income year (1 July 2025 - 30 June 2026).*

## Table of Contents
1. Personal Financial Literacy Fundamentals
2. Budgeting
3. Accounting Fundamentals for Personal Finance
4. Debt, Credit & Borrowing
5. Savings, Investing & Wealth Building
6. Key Personal Finance Ratios & Metrics
7. Taxes & Regulatory (Generic + Mauritius)
8. Currency, Formatting & Financial Conventions
9. Behavioral & Psychological Aspects
10. Financial Planning Frameworks

---

## 1. Personal Financial Literacy Fundamentals

**Financial literacy** is the ability to understand and effectively use financial skills - budgeting, saving, investing, borrowing, and risk management - to make informed decisions. It matters because it determines a person's ability to avoid harmful debt, build wealth, withstand emergencies, and reach life goals.

### Core concepts
- **Income - gross vs net:** Gross income is total earnings before deductions; net (take-home) income is what remains after taxes and statutory deductions. Budgeting should generally be based on net income.
- **Expenses:** Outflows of money. Categorized as fixed, variable, periodic, discretionary, and non-discretionary.
- **Assets:** Things you own with economic value (cash, deposits, investments, property, vehicles).
- **Liabilities:** What you owe (loans, credit card balances, mortgages).
- **Net worth:** Assets − Liabilities. The single best snapshot of financial health.
- **Cash flow:** Money in vs money out over a period. Positive cash flow builds wealth; negative erodes it.
- **Liquidity:** How quickly an asset can be converted to cash without losing value. Cash is most liquid; real estate is illiquid.
- **Solvency:** Ability to meet long-term obligations (positive net worth); distinct from liquidity (short-term).

### Income → spending → saving → investing
The flow: earn income → cover essential spending → save (set aside for safety/short-term goals) → invest (grow wealth long-term). The "gap" between income and spending is the engine of wealth building.

### Time value of money (TVM)
A unit of money today is worth more than the same unit in the future, because it can earn returns.
- **Future Value:** FV = PV × (1 + r)^n
- **Present Value:** PV = FV ÷ (1 + r)^n
- **Simple interest:** I = P × r × t (interest only on principal)
- **Compound interest:** A = P × (1 + r/n)^(n×t) (interest on principal + accumulated interest)
- **Rule of 72:** Years to double ≈ 72 ÷ annual % rate. Most accurate for rates of 6-10%; use 69.3/70 for continuous/daily compounding and low rates. Used both for investment growth and for inflation's halving of purchasing power (e.g., at 3% inflation, money loses half its buying power in ~24 years).

### Inflation & purchasing power
Inflation is the general rise in prices over time, eroding purchasing power. Investments must outpace inflation to preserve real wealth. Real return ≈ nominal return − inflation rate.

### Financial goal setting & SMART goals
- **Short-term** (<1 yr): emergency fund, small purchases.
- **Medium-term** (1-5 yrs): car, down payment, debt payoff.
- **Long-term** (5+ yrs): retirement, education, mortgage payoff.
- **SMART:** Specific, Measurable, Achievable, Relevant, Time-bound.

### Financial life stages
Needs evolve across a lifetime: (1) Early career/accumulation - build emergency fund, manage student debt, start investing; (2) Family/peak earning - mortgage, children's education, insurance, retirement contributions; (3) Pre-retirement - maximize savings, de-risk; (4) Retirement/decumulation - drawdown, estate planning. Risk tolerance generally declines and liquidity needs rise with age.

---

## 2. Budgeting

A **budget** is a plan that allocates income to expenses, savings, and debt repayment over a period. The philosophy: give every unit of money intention so spending aligns with values and goals, rather than drifting.

### Major budgeting methods/frameworks

| Method | How it works | Best for |
|---|---|---|
| **50/30/20 rule** | 50% needs, 30% wants, 20% savings/debt (of after-tax/net income). Introduced by Elizabeth Warren and Amelia Warren Tyagi in their 2005 book *All Your Worth: The Ultimate Lifetime Money Plan*. | Beginners; low-effort structure |
| **Zero-based budgeting** | Income − expenses = 0; every unit assigned a job. | Detail-oriented; aggressive goals |
| **Envelope / cash-stuffing** | Cash divided into category envelopes; spend only what's in each. | Overspenders; tactile control |
| **Pay-yourself-first / reverse budgeting** | Save a set amount first, spend the rest freely. | Disciplined savers with surplus |
| **Values-based budgeting** | Allocate spending to what you value most. | Aligning money with priorities |
| **Anti-budget** | Save a fixed % off the top; don't track the rest. | Minimalists |
| **Kakeibo (Japanese)** | Pen-and-paper mindful journaling. Four categories: Needs (survival), Wants (optional), Culture/leisure, Unexpected. Four monthly questions: How much do I have? How much do I want to save? How much am I spending? How can I improve? Published 1904 by Hani Motoko, Japan's first female journalist; revived in the West via Fumiko Chiba's 2018 book *Kakeibo: The Japanese Art of Saving Money*. | Mindful spenders; behavior change |
| **60/30/10, 70/20/10** | Variants adjusting need/want/save percentages for higher-cost-of-living. | High-cost areas |

### Expense classification
- **Fixed:** Same each period (rent, loan payments, insurance premiums).
- **Variable:** Fluctuate (groceries, utilities, fuel).
- **Periodic/irregular:** Occur occasionally (annual insurance, car registration, holidays) - best handled with sinking funds.
- **Discretionary** (wants) vs **non-discretionary** (needs).

### Needs vs wants vs savings
- **Needs:** Essentials for living - housing, basic food, utilities, transport, minimum debt payments, insurance.
- **Wants:** Quality-of-life but non-essential - dining out, entertainment, subscriptions.
- **Savings:** Future-oriented - emergency fund, investments, extra debt payments.

### Income categorization
- **Salary/wages:** Regular, predictable.
- **Freelance/self-employment:** Variable, requires tax set-aside.
- **Passive:** Rent, dividends, interest, royalties.
- **Irregular:** Bonuses, commissions, gifts, windfalls.

### Standard personal expense taxonomy

| Category | Subcategories |
|---|---|
| **Housing** | Rent/mortgage, property tax, maintenance/repairs, HOA/syndic fees, furnishings |
| **Utilities** | Electricity, water, gas, internet, mobile, waste |
| **Food** | Groceries, dining out, takeaway, coffee |
| **Transport** | Fuel, public transport, vehicle loan, insurance, maintenance, parking, ride-hailing |
| **Healthcare** | Insurance premiums, doctor/dental, medication, hospital |
| **Insurance** | Life, health, home, auto, disability |
| **Debt payments** | Credit cards, personal/student/auto loans |
| **Personal care** | Haircuts, toiletries, gym, clothing |
| **Entertainment/Leisure** | Streaming, hobbies, travel, events |
| **Education** | Tuition, books, courses, childcare/school fees |
| **Family/Dependents** | Childcare, child support, elder care, pets |
| **Savings/Investments** | Emergency fund, retirement, brokerage, sinking funds |
| **Gifts/Donations** | Charity, presents |
| **Miscellaneous** | Bank fees, subscriptions, unexpected |

### Budgeting for irregular/variable income
Base the budget on a conservative baseline (lowest typical month or trailing average). Prioritize essentials; in high months, fund sinking funds and savings; use a "buffer/income-smoothing" account to even out lean months. Set aside taxes immediately on each payment.

### Sinking funds & emergency funds
- **Sinking fund:** Money set aside gradually for a known future expense (car, holiday, insurance renewal), preventing budget shocks.
- **Emergency fund:** 3-6 months of essential expenses (more - 9-12 months - for single-income households, volatile industries, or the self-employed). Keep in a liquid, safe, accessible account (e.g., high-yield savings), separate from daily spending. Bare minimum: 3 months.

### Common budgeting mistakes & behavioral pitfalls
Underestimating irregular expenses; not tracking actuals; setting unrealistic limits; ignoring small recurring "leaks"; no buffer; not adjusting as life changes; treating the budget as set-and-forget. The best budgeting method is the one you'll actually stick with.

### Variance analysis (planned vs actual)
**Budget variance = Actual − Planned.** Favorable variance: spent less / earned more. Unfavorable: spent more / earned less. Reviewing variances regularly (monthly) identifies overspending patterns and informs adjustments.

---

## 3. Accounting Fundamentals for Personal Finance

### The accounting equation
**Assets = Liabilities + Equity** (for individuals, Equity = Net Worth).
Every transaction keeps this equation in balance. An expanded form: Assets = Liabilities + Equity + Income − Expenses.

### Double-entry bookkeeping
Every transaction is recorded with equal and opposite entries (a debit and a credit) so the books always balance. This self-balancing property catches errors. Example: take a loan → Cash (asset) up, Loan payable (liability) up.

### Debits & credits - normal balances

| Account type | Increases with | Normal balance |
|---|---|---|
| Assets | Debit | Debit |
| Expenses | Debit | Debit |
| Liabilities | Credit | Credit |
| Equity | Credit | Credit |
| Income/Revenue | Credit | Credit |

Mnemonic: Debits increase what you *have* (assets, expenses); credits increase what you *owe or earned* (liabilities, equity, income).

### Single-entry vs double-entry
- **Single-entry:** One line per transaction (like a checkbook register). Simple, no built-in error-checking, no balance sheet. Adequate for basic personal tracking.
- **Double-entry:** Two equal/opposite entries; produces both balance sheet and income statement; catches arithmetic errors. More robust for serious personal finance.

### Chart of accounts (personal)
A structured list of all accounts, typically organized: Assets (cash, bank accounts, investments, property), Liabilities (credit cards, loans), Equity/Net Worth, Income (salary, interest, dividends), Expenses (by category above).

### Accrual vs cash basis
- **Cash basis:** Record when money changes hands. Simpler; suits most personal budgeting.
- **Accrual basis:** Record when earned/incurred regardless of cash timing. More accurate for matching but complex. Personal finance generally uses cash basis, sometimes with accruals for known upcoming obligations (sinking funds approximate accrual thinking).

### Ledgers, journals, trial balance
- **Journal:** Chronological record of transactions (daybook).
- **General ledger:** All accounts with their running balances.
- **Trial balance:** List of all account balances; total debits must equal total credits - a check on accuracy.

### Reconciliation
**Bank reconciliation** matches your records against the bank statement to catch errors, omissions, fees, or fraud. Concept applies to any account: compare recorded balance to actual.

### Financial statements (and personal equivalents)

| Business statement | Shows | Personal equivalent |
|---|---|---|
| **Balance sheet** (Statement of Financial Position) | Assets, liabilities, equity at a point in time | **Personal net worth statement** |
| **Income statement** (P&L) | Income − expenses over a period = profit/loss | **Personal cash flow / income statement** |
| **Cash flow statement** | Cash movements (operating, investing, financing) | **Personal cash flow statement** |

They interrelate: net income from the income statement flows into equity on the balance sheet; cash flow reconciles the cash asset.

### Balances & transaction flow
- **Opening balance:** Account value at period start.
- **Closing balance:** Value at period end = opening + inflows − outflows.
- **Running balance:** Updated balance after each transaction.
Transactions flow from journal → ledger → trial balance → financial statements.

---

## 4. Debt, Credit & Borrowing

### Types of debt
- **Secured:** Backed by collateral (mortgage, car loan); lower rates, asset at risk.
- **Unsecured:** No collateral (credit cards, personal loans); higher rates.
- **Revolving:** Reusable credit line (credit cards, overdrafts, lines of credit).
- **Installment:** Fixed payments over set term (mortgages, car/personal loans).
- **Good debt:** Finances appreciating assets or income potential (mortgage, education, business).
- **Bad debt:** Finances depreciating assets or consumption at high interest (credit card balances, BNPL for wants).

### Interest rates
- **APR (Annual Percentage Rate):** Yearly cost of borrowing including certain fees; doesn't compound within the year.
- **APY/EAR (Annual Percentage Yield / Effective Annual Rate):** Includes compounding; the true rate.
- **Nominal vs effective:** Nominal ignores compounding frequency; effective accounts for it.
- **Fixed vs variable:** Fixed stays constant; variable moves with a benchmark rate.

### Loan amortization
Each payment splits between **interest** (on outstanding balance) and **principal** (reduces balance). Early in an amortizing loan, most of the payment is interest; later, most is principal. An amortization schedule maps this over the term.

### Credit scores & creditworthiness
Creditworthiness is assessed on the "5 Cs": Character (history), Capacity (income/DTI), Capital, Collateral, Conditions. In score-based systems (e.g., US FICO), key factors are payment history, amounts owed/utilization, length of history, new credit, credit mix.

**Mauritius does NOT use a US-style numeric credit score.** Creditworthiness is assessed through the **Mauritius Credit Information Bureau (MCIB)** - the only credit bureau in Mauritius - which is "fully owned and operated by the Bank of Mauritius from within its premises." Established under Section 52 of the Bank of Mauritius Act 2004, it came into operation on **1 December 2005**. The MCIB is "a repository of credit information, both positive and negative, on all recipients of credit facilities and guarantors" - covering name, address, date of birth, NIC number, and facility details (original amount, outstanding balance, repayments, arrears, suit-filed/bankruptcy records) from banks, leasing/insurance companies, utilities, and others. Critically, it generates no score or opinion: *"It only gives factual information on borrowers' credit exposures. The final decision to grant a facility or otherwise rests entirely on the lender. The MCIB does not provide any opinion on the applicant."* Consultation is mandatory before approving, increasing, or renewing a facility. Positive information is purged three years after a facility is repaid.

### Debt repayment strategies
- **Avalanche:** Pay highest-interest debt first (minimums on rest). Mathematically cheapest; saves most interest.
- **Snowball:** Pay smallest balance first. Psychologically motivating via quick wins.
- **Consolidation:** Combine multiple debts into one (lower-rate) loan or balance-transfer card for simplicity and possibly lower rates.
- Always pay all minimums to protect credit standing.

### Common credit products
Mortgages (long-term secured property loans), personal loans (unsecured installment), car loans (secured), credit cards (revolving unsecured), overdrafts (short-term account borrowing), lines of credit (flexible revolving), BNPL (Buy Now Pay Later - short-term installment, often interest-free if paid on time but can carry fees/penalties).

### Debt metrics
- **Debt-to-Income (DTI):** Total monthly debt payments ÷ gross monthly income. Lenders prefer <36%; >43% makes mortgages difficult; >50% signals stress.
- **Front-end DTI:** Housing costs ÷ gross income (target ≤28%).
- **Back-end DTI:** All debt ÷ gross income (target ≤36%).

---

## 5. Savings, Investing & Wealth Building

### Saving vs investing
- **Saving:** Setting aside money in safe, liquid form (low risk, low return). For emergencies and short-term goals.
- **Investing:** Committing money to assets expecting growth (higher risk/return). For long-term goals.

### Deposit/savings vehicles
Savings accounts (liquid, variable interest), fixed/term deposits (locked for a term at fixed rate), recurring deposits (regular contributions), money market accounts.

### Investment vehicles overview
- **Stocks/equities:** Ownership shares; highest long-term growth potential, highest volatility.
- **Bonds:** Debt instruments; steadier income, lower risk than stocks.
- **Mutual funds:** Pooled, professionally managed.
- **ETFs:** Exchange-traded baskets; low-cost diversification.
- **Index funds:** Track a market index; low fees, broad diversification.
- **Real estate:** Property for rent/appreciation; illiquid.
- **Retirement accounts:** Tax-advantaged long-term vehicles.
- **Commodities:** Gold, oil, etc.; inflation hedge/diversifier.

### Core investing principles
- **Risk vs return:** Higher expected returns require accepting higher risk/volatility.
- **Diversification:** Spreading across/within asset classes reduces unsystematic risk.
- **Asset allocation:** Dividing portfolio among stocks/bonds/cash based on goals, time horizon, risk tolerance. The dominant driver of long-term results. Shifts more conservative with age/shorter horizon.
- **Dollar-cost averaging (DCA):** Investing fixed amounts at regular intervals, reducing timing risk and average cost per share.
- **Compound growth:** Reinvested returns earn returns; the earlier you start, the more powerful (the "eighth wonder").

### Retirement planning concepts
Estimate retirement needs, leverage tax-advantaged accounts, contribute consistently, harness compounding, and shift to lower-risk assets near retirement. The **"4% rule"** (target ~25× annual expenses) was introduced by financial planner William P. Bengen in his October 1994 *Journal of Financial Planning* paper; his original analysis yielded ~4.15% as a safe initial withdrawal rate for a 30-year retirement, and in his 2025 book *A Richer Retirement* he revised his "SAFEMAX" upward to 4.7%.

### Mauritius retail investing infrastructure
- **Stock Exchange of Mauritius (SEM):** Operated by the Stock Exchange of Mauritius Ltd (established under the Stock Exchange Act 1988; trading began July 1989), regulated by the Financial Services Commission. Two main markets - the Official Market and the Development & Enterprise Market (DEM). Key indices: **SEMDEX** (benchmark all-share, capitalisation-weighted, base 5 July 1989 = 100), **SEMTRI** (total return), and **SEM-10** (ten-largest blue-chip investible index, launched 2 October 2014). Retail investors trade via a licensed investment dealer/stockbroker, with settlement through the Central Depository & Settlement Co (CDS) on a T+3 basis. **Officially listed shares attract no capital gains tax and no withholding tax on dividends.**
- **Bank deposits:** Savings accounts (variable rate) and fixed/term deposits offered by commercial banks (MCB, SBM, AfrAsia, etc.).
- **Bank of Mauritius policy rate (the "Key Rate"):** raised to 4.50% on 4 February 2025, held through 2025, and raised 25 bps to **4.75%** on 20 May 2026 (its highest level since 2013). BoM's medium-term inflation target range is 2-5%.
- **Government retail securities (issued via the Bank of Mauritius):** Treasury Bills (short-term), Treasury Notes (medium-term), and Government of Mauritius Bonds (5-20 year tenors), plus Inflation-Indexed Bonds and dedicated retail **Savings Bonds**. Retail savings bonds have historically carried a minimum of Rs 50,000 (in multiples) and a maximum of Rs 500,000 per holder, with both fixed-coupon and inflation-linked versions - though specific pricing varies by each issue.

---

## 6. Key Personal Finance Ratios & Metrics

| Ratio | Formula | Healthy benchmark |
|---|---|---|
| **Savings rate** | Savings ÷ gross (or net) income | 10-20%+; 15-20% for wealth building |
| **Emergency fund ratio** | Liquid cash ÷ monthly essential expenses | 3-6 months (more if volatile) |
| **Liquidity ratio** | Liquid assets ÷ monthly expenses | ≥3-6 months |
| **Debt-to-Income (DTI)** | Monthly debt payments ÷ gross monthly income | <36% |
| **Front-end housing ratio** | Housing costs ÷ gross income | ≤28% |
| **Back-end ratio (28/36 rule)** | Total debt ÷ gross income | ≤36% |
| **Debt-to-assets** | Total debt ÷ total assets | Lower is better |
| **Personal cash flow** | Income − expenses | Positive |
| **Net worth** | Assets − Liabilities | Positive, growing |
| **Net worth growth** | (End − Start) ÷ Start | Positive trend |
| **Expense ratio (personal)** | Total expenses ÷ income | <100%; lower is better |
| **Retirement/FI ratio** | Invested assets ÷ annual expenses | ~25× for financial independence |

The **28/36 rule:** spend ≤28% of gross income on housing and ≤36% on total debt.

---

## 7. Taxes & Regulatory

### Generic/international tax literacy
- **Taxable income:** Income subject to tax after exemptions/deductions.
- **Deductions:** Reduce taxable income.
- **Tax credits:** Reduce tax payable directly.
- **Tax brackets:** Progressive systems tax higher income at higher marginal rates.
- **Marginal vs effective rate:** Marginal = rate on the next unit earned; effective = total tax ÷ total income.
- **Withholding/PAYE:** Tax deducted at source by employers.
- Common taxes: income tax, VAT/GST/sales tax, capital gains tax, property tax, inheritance/estate tax, social security contributions.

### Mauritius-specific (income year 1 July 2025 - 30 June 2026)

**Administered by the Mauritius Revenue Authority (MRA)** on a self-assessment basis. **Fiscal/income year runs 1 July to 30 June.**

**Personal income tax bands (effective 1 July 2025, per Finance Act 2025 [Act No. 18 of 2025, gazetted 9 August 2025] - reduced from 11 bands to 3):**

| Annual chargeable income (Rs) | Rate |
|---|---|
| First 500,000 | 0% |
| Next 500,000 (500,001-1,000,000) | 10% |
| Remainder (above 1,000,000) | 20% |

- **Exempt employee threshold:** No PAYE on monthly emoluments not exceeding **Rs 38,462** (raised from Rs 30,000 under Finance Act 2025 §2(a); directors excluded).
- **Young persons aged 18-25** earning up to Rs 1m annually are exempted from income tax.
- Per the Budget 2025-2026, these changes "are expected to remove 44,000 individuals from the tax net and reduce tax liability for 75,000 more."

**Fair Share Contribution (FSC):** Introduced by Finance Act 2025, effective for the income year commencing 1 July 2025 and the two subsequent years. Per PwC Worldwide Tax Summaries, an individual whose net income (including domestic dividends and resident société/succession dividend shares) exceeds **MUR 12 million** pays FSC at **15% of leviable income above MUR 12 million**, collected under PAYE. (This replaced the former Solidarity Levy, abolished from year of assessment 2023/24.)

**Key personal reliefs/deductions (income year ending 30 June 2026):**
- 0% rate on first Rs 500,000 (functions as a personal exemption).
- Medical/health insurance premium relief: Rs 25,000 (self), Rs 25,000 (1st dependent), Rs 20,000 (2nd-4th each).
- Approved personal pension scheme contributions: up to Rs 50,000.
- Charitable donations (electronic): up to Rs 100,000.
- Private school fees: up to Rs 60,000 per child.
- Housing loan interest relief (conditions; not allowed if total income exceeds Rs 4 million).
- Dependent deductions, with income caps per dependent (Rs 110,000 for 1st; Rs 80,000 2nd; Rs 85,000 3rd; Rs 80,000 4th).
- Deductions for solar energy units, rainwater harvesting, EV fast chargers.
- Reliefs/deductions are claimed via the Employee Declaration Form (EDF) filed with the employer/MRA.

**Social contributions (replacing the former National Pensions Fund/NPF since Sept 2020):**

| Contribution | Employee | Employer |
|---|---|---|
| **CSG (Contribution Sociale Généralisée)** - basic salary ≤ Rs 50,000/month | 1.5% | 3% |
| **CSG** - basic salary > Rs 50,000/month | 3% | 6% |
| **NSF (National Savings Fund)** | 1% | 2.5% |
| **HRDC Training Levy / SDL** | - | 1.5% |
| **PRGF (Portable Retirement Gratuity Fund)** | - | ~4.5% |

- CSG has no salary ceiling (except self-employed, who pay a fixed Rs 150/month). NSF has a published insurable-salary ceiling (around Rs 28,570/month for 2025/26).
- CSG is a pay-as-you-go system funding pensions and allowances (CSG Income Allowance, Child Allowance, School Allowance).

**VAT in Mauritius:** Standard rate **15%** (introduced 1998; no reduced rate). Compulsory registration threshold lowered from Rs 6 million to **Rs 3 million** annual turnover (from 1 October 2025). Late filing/payment attracts a 5% surcharge plus penalties, up to 100% of tax due.
- **Zero-rated supplies (Fifth Schedule, input VAT recoverable):** exported goods; basic foodstuffs such as rice, wheat flour and bran, bread, edible oils, margarine/butter, milk/cream, cheese, sugar; unprocessed primary agricultural/horticultural produce (vegetables, fruits, coffee, cocoa, nuts); live food animals, poultry, meat and eggs.
- **Exempt supplies (First Schedule, no input recovery):** medical/hospital/dental and veterinary services; educational and training services from approved institutions; sale/transfer of residential buildings (residential rent); public passenger transport; certain financial/banking services to non-residents.
- From **1 January 2026**, VAT applies to specified foreign-supplied digital/electronic services.

**Other Mauritius features:** No capital gains tax, no inheritance tax, no wealth tax, no property tax (only land transfer/registration duties). Corporate income tax generally 15%.

(MU) **Inflation context:** Headline inflation for calendar year 2025 was **3.7%** (Statistics Mauritius, "Consumer Price Index - Year 2025," published 16 January 2026), up marginally from 3.6% in 2024. (BoM's forward projection for 2026 was revised upward to ~5.5% in May 2026 citing fuel/geopolitical risks - a forecast, not a realized figure.)

**Pensions/retirement (Mauritius):**
- **Basic Retirement Pension (BRP)** - universal, non-contributory, tax-funded. Amount payable from January 2025: Rs 15,000/month (ages 60-89), Rs 22,710 (90-99), Rs 27,710 (100+). Finance Act 2025 is gradually raising the eligibility age from 60 to 65 over a phased period (controversial, subject to legal challenge); an Rs 10,000/month income support bridges those aged 60+ not yet eligible.
- **NSF** - defined-contribution lump sum at retirement.
- **PRGF** - portable gratuity for private-sector employees.
- **Minimum wage:** Rs 17,110/month (from January 2025), plus salary compensation top-ups (Rs 635/month from January 2026 for those earning up to Rs 50,000); a guaranteed minimum income of Rs 20,000 is topped up via the CSG Income Allowance.

---

## 8. Currency, Formatting & Financial Conventions

### Multi-currency & exchange rates
An **exchange rate** is the price of one currency in another. Personal finance apps handling multiple currencies must track the base/reporting currency and convert via current rates; gains/losses arise from rate movements. Formatting conventions vary by locale (decimal separators, symbol placement, grouping).

### Mauritian Rupee (MUR)
- **ISO code:** MUR. **Symbol:** Rs (also ₨). **Subdivision:** 100 cents.
- **Issued by:** Bank of Mauritius (central bank, established 1967). Managed float regime.
- **Banknotes:** Rs 25, 50, 100, 200, 500, 1,000, 2,000. **Coins:** 5c, 20c, 50c, Rs 1, 5, 10, 20.
- **Formatting:** Symbol precedes the amount (e.g., Rs 1,500.50). Comma thousands separator, period decimal.
- **Fiscal year:** 1 July - 30 June (government/tax). Calendar year used for some statistics.

### Date & number conventions
Mauritius commonly uses DD/MM/YYYY date format. English is the language of business/government.

---

## 9. Behavioral & Psychological Aspects

**Behavioral finance** studies how psychology and cognitive biases lead to irrational financial decisions.

### Key biases affecting money
- **Loss aversion:** Losses are felt more intensely than equivalent gains. Tversky & Kahneman (1992, "Advances in Prospect Theory," *Journal of Risk and Uncertainty*) empirically estimated the loss-aversion coefficient at **λ ≈ 2.25** - i.e., losses are weighted roughly 2.25× more heavily than equivalent gains (the concept was first introduced in their 1979 Prospect Theory paper, *Econometrica* 47(2), 263-291). Leads to holding losers too long and avoiding beneficial risk.
- **Mental accounting:** Treating money differently based on source/label (e.g., spending "bonus" money frivolously) while ignoring fungibility.
- **Present bias / hyperbolic discounting:** Overvaluing immediate rewards over future benefits; undermines saving.
- **Anchoring:** Over-relying on first information (e.g., original price).
- **Framing:** Decisions swayed by how options are presented.
- **Overconfidence:** Overestimating one's knowledge/predictive ability.
- **Herd behavior:** Following the crowd (market bubbles/panics).
- **Recency bias:** Overweighting recent events.
- **Endowment effect:** Overvaluing what you already own.
- **Status quo bias / inertia:** Failing to act (not rebalancing, not switching).
- **Confirmation bias:** Seeking info that confirms existing beliefs.

### Habits for financial wellness
Automate savings/payments (defeats present bias and inertia); use separate accounts/envelopes (channels mental accounting productively); pre-commit to rules; track and reflect regularly (kakeibo-style mindfulness); add friction to impulse purchases; review goals periodically.

---

## 10. Financial Planning Frameworks

### Comprehensive financial planning process
1. **Establish goals** and gather data on the current situation.
2. **Analyze** net worth, cash flow, and risk exposures.
3. **Develop a plan** (budget, debt, savings, investment, insurance, tax, estate).
4. **Implement** recommendations.
5. **Monitor and review** periodically, adjusting for life changes.

A common priority sequence: (1) budget & positive cash flow → (2) starter emergency fund → (3) high-interest debt payoff → (4) full emergency fund → (5) retirement/long-term investing → (6) other goals.

### Insurance & risk management
**Risk management process:** identify risks → evaluate (likelihood × impact) → select technique → implement → monitor.
**Four techniques:** Risk **avoidance**, **reduction**, **transfer** (insurance), **retention** (self-insure).
**Key personal insurance types:** life (income replacement for dependents), health (medical costs), disability (income protection), property/home, auto, liability/umbrella, long-term care.
Core insurance principles: insurable interest, indemnity, utmost good faith, law of large numbers.

### Estate & inheritance basics
Estate planning directs asset transfer at death and minimizes complications: wills, beneficiary designations, trusts, powers of attorney. (MU) Note: Mauritius has **no inheritance/estate tax**, though succession is governed by civil-law rules (forced-heirship concepts apply under the Code Civil Mauricien).

---

*End of knowledge base. Mauritius statutory figures are drawn from MRA circulars, the Finance Act 2025, Bank of Mauritius, and Statistics Mauritius, current to the 2025/2026 income year. Tax rates, contribution rates, and benefit amounts change annually - verify against the latest MRA and BoM publications before relying on specific figures.*