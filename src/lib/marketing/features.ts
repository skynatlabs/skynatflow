// What the product does, said as what it does FOR somebody.
//
// One list, read by the features index, every category page, the nav and the
// drift test that keeps those three honest. The nav and the sidebars drifted
// apart once in the dashboard and three pages became unreachable; there is
// no reason to repeat that mistake on the marketing side, so nothing here is
// written down twice.
//
// THE RULE FOR EVERY HEADLINE IN THIS FILE.
//
// A feature name is not a benefit. "Bank reconciliation" tells a business
// owner nothing they did not already know they lacked; "You stop finding out
// you were paid three weeks ago" is the reason they would change software.
// So `benefit` is always a sentence about their business, `how` explains the
// mechanism, and `name` is there for somebody scanning a list looking for a
// word they already have in their head.
//
// THE OTHER RULE: NOTHING HERE MAY CLAIM MORE THAN THE CODE DOES.
//
// Where something needs the business to bring their own account — a payment
// gateway, a bank feed, a WhatsApp number — the copy says so. A marketing
// page that promises a live integration nobody can switch on is the fastest
// way to lose the second month of a subscription.

export interface Feature {
  /** The benefit, as a sentence about the reader's own business. */
  benefit: string;
  /** How it actually works. Two or three sentences, no adjectives. */
  how: string;
  /** What the thing is called, for somebody scanning for a name. */
  name: string;
  /** Stated plainly when something has to be connected or supplied first. */
  needs?: string;
}

export interface FeatureCategory {
  slug: string;
  /** Short label for the nav and the index card. */
  label: string;
  /** One line on the index card. */
  teaser: string;
  /** The page headline. Benefit-shaped, never a category name. */
  headline: string;
  /** The half of the headline that gets the gradient. */
  headlineAccent: string;
  /** One paragraph under the headline. */
  standfirst: string;
  /** The sentence that names the problem this whole category removes. */
  thesis: string;
  features: Feature[];
  /** Three facts worth a stat row, where there are three worth having. */
  proof?: { n: string; label: string }[];
}

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  // ------------------------------------------------------------- money in
  {
    slug: "getting-paid",
    label: "Getting paid",
    teaser: "Quote, invoice, chase and settle — without anybody having to remember.",
    headline: "Stop waiting on money",
    headlineAccent: "nobody is chasing",
    standfirst:
      "Most small businesses are not short of revenue. They are short of the twenty minutes a day it takes to notice that four invoices went quiet, and the nerve to send the fifth reminder. This is the part of the business that runs itself.",
    thesis:
      "A quote that goes unanswered and an invoice that goes unpaid look identical in most software: nothing happens. Here, nothing happening is the thing that triggers the work.",
    proof: [
      { n: "6", label: "rungs on the collections ladder, each one written down so the next message knows what the last one said" },
      { n: "0", label: "reminders sent without somebody seeing the wording first" },
      { n: "1", label: "click for a customer to view, accept and pay — no login, no app" },
    ],
    features: [
      {
        name: "Quotes",
        benefit: "A quote leaves looking like it came from a business three times your size",
        how: "Build from your catalogue or paste a list in your own words and it resolves the customer, the products and the prices. Sends as a branded PDF, tracks whether it was opened, and turns into an invoice in one step when it is accepted.",
      },
      {
        name: "Invoices",
        benefit: "Every invoice knows its own story",
        how: "Sent, seen, part-paid, settled, disputed — the status moves on its own from the payments and the portal, not from somebody updating a spreadsheet column. Part payments, credit notes and refunds all sit against the invoice they belong to.",
      },
      {
        name: "Customer portal",
        benefit: "Your customer can pay you at eleven at night without asking anybody for a login",
        how: "Every customer gets a private link. They see what they owe, what they have paid, every document you have sent them, and they can accept a quote or pay an invoice from it. No account to create, no app to install, no password to forget.",
        needs: "A payment gateway in your own business's name for the paying part; everything else works without one.",
      },
      {
        name: "The collections ladder",
        benefit: "Late invoices get chased properly instead of politely six times",
        how: "A ladder of escalating messages, each rung recorded so the next one knows what the last one said. It stops the moment money lands — not on the next run, immediately, by reading what is actually outstanding. And it never opens with a lawyer's letter to a customer you want to keep.",
      },
      {
        name: "Payment plans",
        benefit: "A customer who cannot pay in full stops becoming a customer who pays nothing",
        how: "Split what is owed into instalments with dates, track each one, and chase only the instalment that is late rather than the whole balance.",
      },
      {
        name: "Statements",
        benefit: "The 'what do I actually owe you' question takes one send",
        how: "A statement per customer, per period, built from the ledger rather than assembled by hand. In their currency and their language where you have set one.",
      },
      {
        name: "Recurring invoices",
        benefit: "Retainers and subscriptions bill themselves",
        how: "Set the shape once — weekly, monthly, quarterly — and the invoice is raised on schedule with the right dates and the right reference.",
      },
      {
        name: "Progress billing",
        benefit: "Long jobs get paid for in stages instead of at the bitter end",
        how: "Agree the stages up front, claim against each one as it completes, and the claim carries what was agreed rather than what somebody remembers agreeing.",
      },
      {
        name: "Late fees",
        benefit: "Being late costs something, and the customer knows in advance",
        how: "A fee applied on your terms against a specific invoice, appearing on the next statement. It never runs on its own — charging a customer is always a decision somebody makes.",
      },
      {
        name: "Disputes",
        benefit: "A complaint stops quietly aging into a write-off",
        how: "When a customer says something is wrong, it becomes a tracked thing with a clock on it instead of an email somebody meant to answer. Nearly half of denied claims are never reworked anywhere; here the aging is visible until it is resolved.",
      },
      {
        name: "Cash sale and till",
        benefit: "A counter sale lands in the books the same way a quoted job does",
        how: "Barcode lookup, checkout, cash or card, and the same ledger discipline whether it came from the till or was typed in by hand. Opening float in, counted cash out, and the variance surfaced rather than absorbed.",
      },
      {
        name: "Unusual amounts",
        benefit: "A quote with an extra zero gets caught before it goes out",
        how: "Compares a document against that specific customer's own history, not a fixed platform threshold, and flags anything three times their normal. It never flags a first-ever document, because there is nothing to compare against.",
      },
    ],
  },

  // ------------------------------------------------------------ money out
  {
    slug: "what-you-spend",
    label: "What you spend",
    teaser: "Bills, approvals, and the questions worth asking before money leaves.",
    headline: "Know what you are paying for",
    headlineAccent: "before you pay it",
    standfirst:
      "Invoice fraud is the most profitable crime committed against small businesses anywhere, and the version that works is not sophisticated: an email saying the banking details have changed, attached to an invoice that looks exactly like every other one. It works because nothing in the business remembers what the details used to be.",
    thesis:
      "Every control here is a question with the fact behind it, and none of them blocks a payment. A system that cries wolf gets switched off; one that blocks payments gets worked around.",
    proof: [
      { n: "6", label: "questions asked of every unpaid bill, automatically" },
      { n: "0", label: "payments blocked — the software's job is to make sure somebody was asked" },
      { n: "∞", label: "history kept on where each supplier gets paid, and who changed it" },
    ],
    features: [
      {
        name: "Before you pay",
        benefit: "Somebody asks the awkward question on every bill, every time",
        how: "Did this supplier really change banks? Is there another supplier on file with almost the same name? Have we had this invoice number before? Is this the same amount as last week? Is this bill sitting just under the approval limit? Each one comes with the fact that prompted it, phrased as a question — because suppliers do change banks and two companies really can be called the same thing.",
      },
      {
        name: "Supplier banking history",
        benefit: "'Our banking details have changed' stops working as an attack",
        how: "Where each supplier gets paid is kept on their record, and every change is kept with who made it and what it was before. A bill from a supplier whose account changed four days ago is not proof of anything — it is the one question worth asking, and today nothing anywhere remembers the answer.",
      },
      {
        name: "Duplicate supplier records",
        benefit: "One supplier stops being two rows quietly splitting their own spend",
        how: "Names that are nearly the same are paired up, reading the name both with and without the company suffix. Most are a duplicate record making every supplier report wrong. Occasionally it is not that.",
      },
      {
        name: "Supplier bills and approvals",
        benefit: "Nothing gets paid that nobody approved",
        how: "Bills are recorded, approved by somebody who can, and only approved bills can enter a payment run. The run itself stops for a person before anything is released.",
      },
      {
        name: "Purchase orders",
        benefit: "What you ordered and what arrived stop being two different conversations",
        how: "Orders go out against a supplier and a price. What was received is matched against what was ordered, so a short delivery is arithmetic rather than an argument.",
      },
      {
        name: "Supplier performance",
        benefit: "You find out which supplier is actually costing you",
        how: "How long each one really takes, their worst delivery, how much has been spent with them, whether their prices have crept up, and orders sent that were never received.",
      },
      {
        name: "Expenses and receipts",
        benefit: "The shoebox of slips becomes a cost you can see",
        how: "Staff submit, somebody approves, and duplicates are caught before they are paid twice. Receipts are read automatically and coded to the right account by rules that learn from what you corrected last time.",
      },
      {
        name: "What everybody else pays",
        benefit: "You find out your supplier price is twelve percent above normal",
        how: "What comparable businesses were actually charged for the same thing, from their own purchase records. Not a scraped list price — the price that was really paid. Nothing is shown unless at least five other businesses stand behind it, and nobody is ever named.",
        needs: "Switching comparison on, which also adds your figures to the anonymous pool. Off by default, and turning it off stops both immediately.",
      },
      {
        name: "Same thing, different supplier",
        benefit: "The saving available this afternoon, with nobody else involved",
        how: "The same product bought from two merchants at two prices, out of your own purchase records. Needs no cohort, no opt-in and no permission — every number in it already belongs to you.",
      },
      {
        name: "Cost rises and repricing",
        benefit: "You stop selling at a margin you have not earned for eight months",
        how: "The catalogue carries a cost that was typed in once; purchase orders carry what the supplier has charged since. When a supplier puts prices up nobody rewrites the catalogue, so the margin report keeps quoting the old figure. This compares the two and tells you the price that would restore the margin the item was originally priced at.",
      },
      {
        name: "Payment runs",
        benefit: "Paying twenty suppliers stops being twenty separate acts of concentration",
        how: "Every approved bill due is assembled into one run. Nothing has gone anywhere until a person releases it, and the run is built from the bills rather than from a list somebody typed.",
      },
    ],
  },

  // ------------------------------------------------------------- the books
  {
    slug: "the-books",
    label: "The books",
    teaser: "Real double-entry underneath, so the tax return is a report and not a reconstruction.",
    headline: "Books that are already right",
    headlineAccent: "when the deadline arrives",
    standfirst:
      "Most small-business software stores documents and calls it accounting. When the tax return is due, somebody spends a fortnight rebuilding a year from bank statements and memory. Underneath this is a real double-entry ledger, so the return is a report rather than a reconstruction.",
    thesis:
      "Every movement of money passes through one place and leaves an audit entry. The ledger refuses edits by design — the only way back is a reversing entry, which is what makes the numbers worth anything.",
    proof: [
      { n: "2", label: "sides to every entry, because the alternative is a spreadsheet that agrees with itself" },
      { n: "5", label: "years of invoice retention SARS requires — kept, and kept correctly" },
      { n: "1", label: "place money moves through, so nothing can be recorded twice or not at all" },
    ],
    features: [
      {
        name: "Double-entry ledger",
        benefit: "Your accountant stops charging you to work out what happened",
        how: "Chart of accounts, journal entries, trial balance and accounting periods. Every sale, payment, refund, expense and stock movement posts itself. Nothing is editable after the fact — a correction is a reversing entry, which is the whole reason the number can be trusted.",
      },
      {
        name: "Bank feeds",
        benefit: "The statement arrives without anybody downloading anything",
        how: "The same statement reaching the same importer without a CSV and an upload, so everything downstream is unchanged: the same duplicate handling, the same matcher, the same rules.",
        needs: "A provider with an adapter for your bank. Providers with no adapter say so in the list rather than appearing as a connect button that fails after you have fetched your credentials.",
      },
      {
        name: "Reconciliation",
        benefit: "Friday afternoon stops being reconciliation afternoon",
        how: "Statement lines are matched to what the business already recorded, with a confidence and a reason in plain words. This is the one job where a machine genuinely beats a person, and not because it is cleverer: it is willing to consider four hundred candidates for one line. Nothing is ever applied on its own.",
      },
      {
        name: "VAT and tax returns",
        benefit: "The return is a button, not a fortnight",
        how: "A structured VAT return built from data that was already clean. South African SARS shapes and US sales-tax shapes, generated rather than reconstructed under deadline pressure.",
      },
      {
        name: "Financial reports",
        benefit: "You can answer 'how are we doing' without phoning anybody",
        how: "Profit and loss, balance sheet, trial balance and a real cash flow statement, over any period, from the same ledger everything else reads.",
      },
      {
        name: "Cash forecast",
        benefit: "You see the tight week three weeks before it arrives",
        how: "What is due in, what is due out, and what that leaves — built from invoices, bills, payment plans and recurring commitments that already exist, not from an optimistic guess.",
      },
      {
        name: "Accruals and provisions",
        benefit: "A profit figure that includes what you already owe",
        how: "Costs incurred but not yet invoiced, and tax provisioned as it is earned rather than discovered in one lump. Depreciation runs on the assets you actually hold.",
      },
      {
        name: "Multi-currency",
        benefit: "A customer who pays in dollars is quoted in dollars, every time",
        how: "Set the currency on the customer rather than on each document, so nobody has to remember. Exchange rates are held per day, shared across the platform, and the rate used is the rate on the document.",
      },
      {
        name: "Branches and consolidation",
        benefit: "Three locations stop being three sets of numbers",
        how: "Each branch keeps its own figures and the group sees the total, with transfers between branches recorded as transfers rather than as sales.",
      },
      {
        name: "Accounting export",
        benefit: "Your accountant gets what they asked for, in the format they asked for",
        how: "A structured export of the ledger rather than a PDF they have to retype.",
      },
      {
        name: "The audit trail",
        benefit: "Every money movement can be explained, months later, to somebody who is not you",
        how: "Who did what, when, and to which record — written as a side effect of the action rather than as a thing somebody remembers to log.",
      },
    ],
  },

  // -------------------------------------------------------- stock & price
  {
    slug: "stock-and-pricing",
    label: "Stock and pricing",
    teaser: "Where things are, what they cost, what they are worth, and whether they are real.",
    headline: "Know what is on the shelf",
    headlineAccent: "and what it is really costing you",
    standfirst:
      "Stock is where small businesses lose margin invisibly: expiry written off, a supplier price that went up eight months ago, a kitchen using a portion and a half for every portion sold, and a pallet of fakes nobody spotted. None of it appears as a line anywhere. It appears as a margin four points lower than the spreadsheet said.",
    thesis:
      "The system holds both halves of every one of these problems already. What has been missing is the comparison.",
    proof: [
      { n: "1", label: "onion consumed per five plates, exactly — the part-used remainder is carried, never rounded" },
      { n: "0", label: "picks that ignore expiry to save a walk" },
      { n: "11km", label: "the closest a counterfeit cluster is ever located, on purpose" },
    ],
    features: [
      {
        name: "Catalogue",
        benefit: "One list of what you sell, and everything reads from it",
        how: "Products and services with cost, price, tax, units, SKUs, images and stock. Quotes, invoices, the till, purchase orders and the warehouse all read the same row, so a price change happens once.",
      },
      {
        name: "Inventory",
        benefit: "You reorder before a customer asks, not after",
        how: "Demand velocity and reorder points computed from the sales that already happened — statistics, not a guess and not an AI call. Fast, slow, dead and unrated, so the money tied up in stock nobody wants is visible.",
      },
      {
        name: "Batches and expiry",
        benefit: "Expiry write-offs stop being a surprise",
        how: "Stock received in batches with dates, and the risk surfaced before the date rather than at it. The hook for pharmacy, food and agricultural inputs — and the reason a count matters.",
      },
      {
        name: "Warehouse bins",
        benefit: "Picking stops depending on whoever has worked there longest",
        how: "Not how many you have — where they are, and in what order to walk. Rack codes, a walking sequence, and bins you can hold back for quarantine, damage or returns.",
      },
      {
        name: "Directed picking",
        benefit: "A pallet stops going out of date behind a newer one",
        how: "Within one product the batch that expires first is sent even when it is further to walk. Across products the whole list is ordered by the walk, so it is one pass through the building rather than a tour dictated by the order somebody typed the lines. Says plainly what it is short rather than quietly picking less.",
      },
      {
        name: "Cycle counts",
        benefit: "You find out which bin drifts, instead of counting everything once a year",
        how: "Count one bin, set it to what was counted, and see only what changed. The value of a weekly count is not the count — it is knowing which shelf loses things.",
      },
      {
        name: "Stocktake and shrinkage",
        benefit: "The gap between the system and the shelf becomes a number",
        how: "Counted against expected, per item, per person who counted. A physical count always wins over what the ledger assumed, and the variance is recorded rather than absorbed.",
      },
      {
        name: "Recipes and plate cost",
        benefit: "A kitchen stops losing four margin points to nobody in particular",
        how: "Say what a dish is made of and selling one takes the ingredients off the shelf. The next count then shows the difference between what should have been used and what was — which is where the margin goes. Ingredients with no cost on them are named rather than counted as free.",
      },
      {
        name: "Menu margins",
        benefit: "You find the two dishes that lose money among the thirty that do not",
        how: "Every dish ranked by the margin actually being earned, worst first. A menu ordered by name hides exactly the rows worth looking at.",
      },
      {
        name: "Product authentication",
        benefit: "A farmer can tell whether the seed in their hand is real",
        how: "A unique code under a scratch panel. The buyer checks it and gets an answer instantly. Every check is kept — including the ones on codes that are not yours, because a fake carries a code that is not in the database and a system that only records the hits cannot see counterfeiting at all.",
      },
      {
        name: "Counterfeit clusters",
        benefit: "You find out which town has a problem",
        how: "Failed checks grouped by area, to about eleven kilometres and never closer. Enough to send somebody to look; never enough to accuse a particular shop on the evidence of some failed scans.",
      },
      {
        name: "Rentals",
        benefit: "Things that go out and come back stop going missing",
        how: "Mark an item rentable, rent it, and see what is out and what is overdue.",
      },
    ],
  },

  // ---------------------------------------------------------------- trade
  {
    slug: "shop-floor-and-trade",
    label: "Shop floor and trade",
    teaser: "The till, the credit book, the rewards card, and the rep walking the route.",
    headline: "Built for how trade",
    headlineAccent: "actually works here",
    standfirst:
      "Most retail and distribution software is designed for a shop with a street address, a card machine and a customer who has an email. A great deal of trade on this continent has none of those. It has a phone number, a notebook, a rep on a route, and a shopkeeper who sells on credit all day.",
    thesis:
      "None of this is a lesser version of the real product. It is the real product, designed for the counter rather than the desk.",
    proof: [
      { n: "1", label: "phone number as identity — no card, no app, no email" },
      { n: "0", label: "second set of books — a credit entry is a real invoice" },
      { n: "150m", label: "how close a rep has to be for a shop visit to count as verified" },
    ],
    features: [
      {
        name: "The credit book",
        benefit: "The notebook stops being the largest asset nobody protects",
        how: "Two fields and an amount, at the counter, and the customer does not have to exist yet. Every entry is a real invoice in the books — so it counts in your balances, your statements and your VAT, and there is no second set of numbers to reconcile at month end.",
      },
      {
        name: "Oldest first, always",
        benefit: "'Thandi paid fifty' lands somewhere sensible without anybody deciding",
        how: "A repayment goes against the oldest debt first, which is the rule every shopkeeper already uses and the one a customer can be told in a sentence. Anything overpaid is reported rather than parked somewhere nobody would find it.",
      },
      {
        name: "Who owes, by age",
        benefit: "You see the debt that is turning into a loss, not the biggest one",
        how: "Ordered by how long it has been sitting, not by size. A big debt from yesterday is trade; a small one from four months ago is somebody who is not coming back.",
      },
      {
        name: "Rewards",
        benefit: "A loyalty scheme that actually enrols people",
        how: "Identity is the phone number — not a card nobody carries, not an app nobody installs. A customer with a number on their record is enrolled on their first sale, because asking a queue of four people whether they would like to join is where loyalty schemes go to die.",
      },
      {
        name: "What the points will cost you",
        benefit: "You know what you will owe when everybody comes back at once",
        how: "Every rewards product reports members. This reports the liability too: points outstanding, and what they are worth if every one of them is redeemed tomorrow.",
      },
      {
        name: "Who stopped coming",
        benefit: "The most valuable list a retailer has and the one nobody keeps",
        how: "Customers who used to buy weekly and have not been in for two months have not churned quietly — they have gone somewhere else, and you already have their number.",
      },
      {
        name: "The trade map",
        benefit: "Your reps stop deciding for themselves which shops matter",
        how: "Every outlet with its channel, its grade, how often it should be called on, and the landmark directions somebody actually needs to find it. Most outlets here have no street address that means anything, and 'after the blue mosque, third gate' is how the call gets made.",
      },
      {
        name: "Journey plans",
        benefit: "A route that gets rained off does not mean a shop waits another week",
        how: "Shops due today are the ones on a route scheduled for today PLUS any past their own visit cadence, overdue first and best shops first within that — so a day that runs short runs short on the least important calls.",
      },
      {
        name: "Verified visits",
        benefit: "A visit report typed up at home stops counting the same as a visit",
        how: "The phone's coordinates are checked against the shop's pin when the rep arrives, and the distance is computed here rather than trusted from the phone. A visit outside the radius is flagged for somebody to look at — never called a lie, because pins get recorded wrong and a shop inside a building may have no signal at all.",
      },
      {
        name: "Strike rate",
        benefit: "Reps stop being measured on something they can manufacture",
        how: "Visits that ended in an order, not visits. A rep measured on visits will produce visits.",
      },
      {
        name: "Distribution picture",
        benefit: "The number a brand asks for first and no distributor can produce",
        how: "For each line, how many of the outlets that bought anything take it. Counted against outlets that actually bought — a shop that ordered nothing is a coverage problem, and counting it here would make every line look weak for a reason that has nothing to do with the line.",
      },
      {
        name: "Must-stock gaps",
        benefit: "The twelve shops a rep should argue with tomorrow morning",
        how: "Outlets not carrying a line that most comparable shops in the same channel do carry. 'Should' is defined by what the trade actually does, not by a list somebody typed in head office two years ago.",
      },
      {
        name: "Listings that have gone",
        benefit: "You notice a competitor taking your shelf",
        how: "An outlet that took something every fortnight for a year and has stopped has not changed its mind. It reads as nothing in a revenue report because the shop is still buying — just not that.",
      },
      {
        name: "Point of sale",
        benefit: "The till and the books stop being two systems",
        how: "Barcode lookup, checkout, cash or card, opening float, closing count and the variance. The same ledger path as every other sale, so nothing has to be reconciled at the end of the day.",
      },
    ],
  },

  // ------------------------------------------------------------- delivery
  {
    slug: "delivery-and-fleet",
    label: "Delivery and fleet",
    teaser: "Getting it there, getting paid for it, and knowing what the second trip cost.",
    headline: "The delivery costs",
    headlineAccent: "that never reach a report",
    standfirst:
      "Two numbers decide whether a delivery business survives here, and neither appears anywhere in a normal set of books: the share of parcels refused at the door, and the money sitting in riders' bags on the road. Both read as fuel.",
    thesis:
      "A rider's bag is a till, and a refused delivery is a countable event. Both are problems this system already knows the shape of.",
    proof: [
      { n: "20–40%", label: "of cash-on-delivery parcels refused at the door across the continent" },
      { n: "1", label: "delivery fee charged for a job sometimes done three times" },
      { n: "10", label: "things a transport operator loses money on, each computed from records that already exist" },
    ],
    features: [
      {
        name: "Cash on delivery",
        benefit: "You know how much of your money is on the road at four in the afternoon",
        how: "A rider's bag opens with a float, everything collected during the run is recorded against it, and it is counted back in at the end. The variance is surfaced rather than absorbed, the same way a till is.",
      },
      {
        name: "A rider answers for what they took",
        benefit: "Nobody is held to a customer who refused to pay",
        how: "What is expected back is the float plus what was actually collected — never what was meant to be collected. That distinction is the difference between a control people accept and one they resent.",
      },
      {
        name: "Every attempt counted",
        benefit: "The second trip stops being invisible",
        how: "Delivered, refused, nobody home, wrong address, cancelled — every try is recorded, including the ones that failed, because the failed ones are the cost nobody counts. Money can only be collected on a delivery that actually happened.",
      },
      {
        name: "Who takes what they order",
        benefit: "You find out which customers are costing you three trips each",
        how: "How many parcels landed, how many were refused, and how many trips each parcel took. Computed only from your own history with that person, only once there is enough of it to mean anything, and never shared with anybody — a shared blacklist would be a better product and a much worse thing to build.",
      },
      {
        name: "Delivery notes",
        benefit: "Part deliveries stop becoming arguments",
        how: "A delivery is not always the whole invoice. Part orders, back orders and a second trip on Thursday are ordinary, and every note knows what it delivered against — so what is still owed on an order is arithmetic rather than memory.",
      },
      {
        name: "Couriers and waybills",
        benefit: "The driver leaves with a manifest instead of a handful of paper",
        how: "Which courier suits a parcel, what it will cost, what to write on the waybill, and a collection sheet the driver signs. Chargeable weight worked out rather than guessed.",
        needs: "Live tracking needs an account with that courier in your own name. The manifest, the costing and the waybill record work without one.",
      },
      {
        name: "The day, in order",
        benefit: "A driver gets a route instead of a pile",
        how: "Stops put in the order they actually make sense in. Not optimal and it does not pretend to be — on a real day of six to twelve stops it is within a few percent, it is explicable, and it runs in a millisecond. A business does not want the mathematically best route; it wants to stop doubling back.",
      },
      {
        name: "Can we fit it in",
        benefit: "You stop promising a day you do not have",
        how: "Ask whether a job fits into the day, and get told the next day it does.",
      },
      {
        name: "Trips and stops",
        benefit: "Where the vehicle went is a record, not a memory",
        how: "Start, stops, arrival and departure, distance, and points along the way where the phone could send them. Works with no signal and syncs when there is some.",
      },
      {
        name: "Detention",
        benefit: "The time you give away at a customer's gate becomes billable",
        how: "Arrival and departure are already recorded. The free period and the rate are yours. What is over the free period is a number you can put on an invoice instead of absorbing.",
      },
      {
        name: "Empty running",
        benefit: "You see the vehicles ending far from base with nothing to bring back",
        how: "Computed from trips that already exist. The single largest avoidable cost in road freight and the one nobody measures.",
      },
      {
        name: "Fuel and consumption",
        benefit: "A fuel problem shows up as a pattern, not as one bad tank",
        how: "Litres per hundred kilometres per vehicle, flagged when it moves — never on a single fill, because a single fill is noise.",
      },
      {
        name: "Recoverable costs",
        benefit: "Tolls and permits stop quietly becoming your cost",
        how: "Costs marked recoverable that never reached an invoice, listed oldest first.",
      },
      {
        name: "Maintenance by distance",
        benefit: "A service happens at the kilometres, not when somebody remembers",
        how: "Due dates computed off the odometer rather than the calendar, plus tyres and consumables as a cost per kilometre.",
      },
      {
        name: "Load planning",
        benefit: "You stop sending a vehicle out illegally loaded",
        how: "Gross weight against what the vehicle may legally carry, before it leaves.",
      },
    ],
  },

  // ----------------------------------------------------------------- team
  {
    slug: "your-team",
    label: "Your team",
    teaser: "Rosters, attendance you can prove, payroll, and the people a payroll system has no row for.",
    headline: "Pay the right people",
    headlineAccent: "for the hours they were there",
    standfirst:
      "Ghost workers — people on a payroll who are not at the site, or one person signing on for three — are the largest single cost leak in guarding, cleaning and farm labour across this continent. Today the supervisor verifies attendance by telephoning the gate. That is not a joke; it is the industry standard.",
    thesis:
      "A roster says somebody was meant to be at a gate. Only a coordinate taken at the gate says they were.",
    proof: [
      { n: "50m", label: "the tightest geofence allowed — anything smaller flags honest people on ordinary phones" },
      { n: "1hr", label: "of grace either side of a shift, so arriving early is not a discrepancy" },
      { n: "0", label: "logins required for a worker to be paid properly" },
    ],
    features: [
      {
        name: "Geofenced sign-on",
        benefit: "Attendance stops being a phone call to the gate",
        how: "The phone's coordinates are checked against the site when somebody signs on. The distance is computed on the server, never trusted from the phone, because a client that reports its own compliance is not evidence of anything.",
      },
      {
        name: "Sign-ons worth a look",
        benefit: "A supervisor gets a short list instead of a suspicion",
        how: "Sign-ons that could not be placed at the site, each with the distance and the reason it could not be confirmed. Never called a ghost-worker report: a phone in a basement has no fix, a pin gets recorded from the wrong side of a wall, and software should not end somebody's job on a number it cannot explain.",
      },
      {
        name: "Rosters",
        benefit: "One guard stops being booked onto two gates at once",
        how: "Shifts with a site, a person, a role and an hourly rate. Overlapping shifts for the same person are refused — a roster that allows it is not a roster, and the mistake is silent until the client phones.",
      },
      {
        name: "Gaps",
        benefit: "The empty shift is found before the client finds it",
        how: "An open shift is a first-class thing with a status, not the absence of a record. Listed soonest first, because a gap tomorrow morning is a different problem from one in three weeks.",
      },
      {
        name: "What the roster will cost",
        benefit: "The month is priced before it is worked",
        how: "Hours and cost from what is actually rostered. Shifts with no rate are counted and named, rather than quietly treated as free.",
      },
      {
        name: "Who turned up",
        benefit: "Missed shifts become a number instead of a feeling",
        how: "Booked against signed-on against confirmed-at-site, per person, with an hour of grace either side. Somebody arriving ten minutes early is not a discrepancy, and treating it as one teaches people to ignore the report.",
      },
      {
        name: "Casual pay",
        benefit: "The people a payroll system has no row for finally have one",
        how: "Farm labour hired for a week, guards on a daily rate, packers paid by the crate. No login, no email, often no bank account. Paid daily, by the piece, into a wallet — and today off a clipboard nobody keeps.",
      },
      {
        name: "The rate is snapshotted",
        benefit: "A raise next month never rewrites what somebody was owed last month",
        how: "Work is priced at the rate in force on the day it was logged, and that price is fixed. The day recorded is the day WORKED, because a clipboard gets typed up on Friday for a week that started on Monday.",
      },
      {
        name: "Approve before pay",
        benefit: "The person writing the clipboard is not the person releasing the money",
        how: "Logged work has to be approved before it can be paid, and nothing can be marked paid that was not approved. That arrangement — one person on both sides — is exactly how a worker who does not exist quietly appears.",
      },
      {
        name: "Payroll",
        benefit: "PAYE, UIF and EMP201 come out right",
        how: "Real tax tables, payslips, and the statutory filing shapes — not a spreadsheet with a formula somebody copied.",
      },
      {
        name: "Attendance and timesheets",
        benefit: "Hours on a job become a cost on that job",
        how: "Clocking on to a day says somebody was at work. Clocking on to a job is what lets the hours be costed against it.",
      },
      {
        name: "Leave",
        benefit: "Leave stops being tracked in somebody's head",
        how: "Requests, approvals, balances and public holidays, visible to the person and to whoever approves.",
      },
      {
        name: "Roles and permissions",
        benefit: "People see what they need and nothing else",
        how: "Built-in roles for owner, staff, rep, driver and technician, plus custom roles you define. A role can never be given a permission its author does not hold.",
      },
      {
        name: "Org chart and performance",
        benefit: "Who reports to whom, and how the team is actually doing",
        how: "Hierarchy, goals and team performance from the work that was recorded rather than from a self-assessment form.",
      },
    ],
  },

  // ------------------------------------------------------------ work/jobs
  {
    slug: "jobs-and-proof",
    label: "Jobs and proof",
    teaser: "Work in the field, evidence it happened, and the certificate at the end.",
    headline: "Prove the work was done",
    headlineAccent: "before there is an argument",
    standfirst:
      "Almost every dispute a service business has is the same dispute: the customer says it was not done, or not done properly, or not done on the day they were billed for. The business knows it was. Neither can show anything, so the business discounts the invoice to keep the relationship — and does it again next month.",
    thesis:
      "What settles it is not a photograph. It is a photograph with a time, a place and a person attached, taken before anybody knew there would be an argument.",
    proof: [
      { n: "4", label: "things in a proof pack: where, when, who, and a signature" },
      { n: "1", label: "thumb needed to use field mode — it is built for a roof, not a desk" },
      { n: "0", label: "signal required to record what happened" },
    ],
    features: [
      {
        name: "Job cards",
        benefit: "The physical work is tracked separately from the money",
        how: "What has to be done, by whom, in what order, with tasks that get ticked. Kept apart from pricing so a job that grows does not silently change what was quoted.",
      },
      {
        name: "Field mode",
        benefit: "A screen somebody can use standing on a roof",
        how: "Not everything, smaller — today's work and nothing else, each item one tap from the two or three things that actually happen to it. One thumb, bright sunlight, and a bar of signal that comes and goes.",
      },
      {
        name: "Works offline, properly",
        benefit: "A tunnel stops costing you an afternoon of records",
        how: "Every action is written to a queue first, with a key the phone generated. A phone that retries because it never saw the response does not do the thing twice — which is the entire failure mode of an offline queue.",
      },
      {
        name: "Proof of work",
        benefit: "You stop discounting invoices to keep relationships",
        how: "Before, after, where, when, who and a signature — assembled as the work happens rather than asked for afterwards. None of it is requested twice.",
      },
      {
        name: "Job budgets",
        benefit: "You find out a job is losing money while it can still be fixed",
        how: "What was quoted against what has been spent on labour, materials and subcontractors, as it happens.",
      },
      {
        name: "Subcontractors",
        benefit: "Work you passed on is still work you can see",
        how: "Who has what, what they were agreed, and what they have invoiced.",
      },
      {
        name: "Dispatch board",
        benefit: "The day is a plan instead of a list",
        how: "Who is doing what, where, and in what order — with the stops sequenced so nobody doubles back.",
      },
      {
        name: "Certificates",
        benefit: "The compliance document goes out the same day the job finishes",
        how: "Certificates of compliance, test reports and service records with numbers, findings, an expiry date and the issuer's registration where the trade requires one. The compliance calendar then watches the expiry.",
      },
      {
        name: "Maintenance and retainers",
        benefit: "Recurring service visits stop being forgotten until the customer calls",
        how: "Visits due, visits raised, and retainers that have quietly lapsed.",
      },
      {
        name: "Assets and tools",
        benefit: "You know who has the good drill",
        how: "Issue, return, retire, and the history of who held it. Depreciation runs off the same record.",
      },
      {
        name: "Agreements and e-signature",
        benefit: "A contract gets signed today instead of next week",
        how: "Send it, they sign it in a browser, and the audit trail is kept with it. Nothing in this product binds a business to more than this does, which is why sending one always stops for a person.",
      },
      {
        name: "Obligations after signing",
        benefit: "The half of a contract everybody forgets",
        how: "What the contract commits you to after it is signed — notice windows, renewal dates, deliverables — tracked rather than left in a PDF nobody reopens.",
      },
      {
        name: "Site diaries and photo progress",
        benefit: "The documents that decide construction disputes",
        how: "Geotagged, timestamped, person-attributed photo sets captured as the work happens, scored against the programme. The buyer is usually the financier and the quantity surveyor, not the contractor.",
      },
    ],
  },

  // ------------------------------------------------------- customers/comms
  {
    slug: "customers-and-conversations",
    label: "Customers and conversations",
    teaser: "Everything a customer said, everywhere they said it, in one place.",
    headline: "One conversation",
    headlineAccent: "across every channel",
    standfirst:
      "A customer emails, then sends a WhatsApp, then phones. Three people in the business answer three of those without knowing about the other two. The customer concludes, reasonably, that nobody is paying attention.",
    thesis:
      "The customer record is the thread. Everything attaches to it rather than living in whichever inbox happened to receive it.",
    proof: [
      { n: "1", label: "record per customer — documents, messages, calls, deliveries and disputes all hang off it" },
      { n: "0", label: "logins a customer needs to see what they owe" },
      { n: "9", label: "digits matched on a phone number, so 072, +2772 and 2772 are one person" },
    ],
    features: [
      {
        name: "The customer record",
        benefit: "Everything about somebody is in one place, finally",
        how: "Contact details, addresses, tax numbers, registration numbers, their language, their currency, every document, every payment, every delivery, every conversation and every dispute.",
      },
      {
        name: "WhatsApp",
        benefit: "You reach people where they already are",
        how: "Documents, statements and reminders shared straight into the thread the customer already uses, rather than to an email address they check on Tuesdays.",
        needs: "A WhatsApp Business number in your own name for the automated side; sharing works without one.",
      },
      {
        name: "Shared mailbox",
        benefit: "Email stops being one person's private pile",
        how: "Connect the business mailbox, and mail lands against the customer it came from. Anybody who should see it, does.",
        needs: "Your own mailbox credentials. The hosts and ports for common providers are filled in for you.",
      },
      {
        name: "Conversations and call logs",
        benefit: "'What did we tell them last time' has an answer",
        how: "What was said, by whom, and when — including the phone calls, which is where the promises usually get made.",
      },
      {
        name: "Broadcast",
        benefit: "Telling everybody something stops being a copy-and-paste morning",
        how: "One message to a list, with the skipped list shown before anything is sent. A draft nobody read is one release away from a lost customer.",
      },
      {
        name: "Consent",
        benefit: "You can prove somebody agreed to be contacted",
        how: "Consent recorded per contact and per channel, which is what POPIA and GDPR actually ask for.",
      },
      {
        name: "Lead forms and website",
        benefit: "An enquiry becomes a customer record without retyping",
        how: "Forms that post straight into the system, plus simple pages you can publish without a web developer.",
      },
      {
        name: "Reviews and reputation",
        benefit: "The happy customers are asked, and the unhappy ones are caught first",
        how: "A review request fires when an invoice settles, not at random.",
      },
      {
        name: "Bookings and appointments",
        benefit: "The diary stops being double-booked",
        how: "Available slots from your own working pattern, bookings against them, and reminders before the day.",
      },
      {
        name: "Documents in their language",
        benefit: "An invoice arrives in a language the customer reads",
        how: "Set the language on the customer and their documents follow, rather than somebody remembering to switch it each time.",
      },
    ],
  },

  // ----------------------------------------------------------- compliance
  {
    slug: "compliance-and-trust",
    label: "Compliance and trust",
    teaser: "The dates you owe somebody, the proof you kept, and what happens to your data.",
    headline: "Never be surprised",
    headlineAccent: "by a date you already agreed to",
    standfirst:
      "Every licence, certificate, return and renewal in a business is a date somebody already agreed to. Missing one is almost never a decision — it is a date that lived in one person's head, in one year's diary, in a folder nobody opened.",
    thesis:
      "The software's contribution is not knowing the law. It is noticing before the date, and being able to say what the consequence actually is.",
    proof: [
      { n: "5", label: "years of invoice retention SARS requires — built in, not bolted on" },
      { n: "7", label: "days' notice before an account closure completes, with a copy of the records offered" },
      { n: "0", label: "money movements without an audit entry" },
    ],
    features: [
      {
        name: "Compliance radar",
        benefit: "You find out in time, every time",
        how: "Everything the business owes somebody by a date: statutory filings, licences, certificates, tax returns, insurance, contract notice windows and document expiries. What is overdue, due now, coming up, and what has lapsed badly enough to stop work.",
      },
      {
        name: "The obligation library",
        benefit: "You do not have to know what you are supposed to file",
        how: "A curated library of obligations per jurisdiction, loaded the first time a country is asked about, so a new business is not expected to already know its own calendar.",
      },
      {
        name: "Audit trail",
        benefit: "Anything can be explained to somebody who was not there",
        how: "Who did what, when, to which record, with what permission — written as a side effect of the action. Every money movement passes through one place, and that place records it.",
      },
      {
        name: "Data protection",
        benefit: "A POPIA or GDPR request has an answer",
        how: "Consent per contact and channel, a record of what is held, and the ability to produce or remove a person's data without a developer.",
      },
      {
        name: "Your data is yours",
        benefit: "Closing the account gives you your records, not a fight",
        how: "An owner types the business name, waits a week, and is offered a complete copy of every table the workspace owns on the way out. The export claims completeness and means it — an export that silently stopped at a page would be worse than none.",
      },
      {
        name: "Errors are visible",
        benefit: "Something breaking stops depending on a customer reporting it",
        how: "Production faults are grouped, counted and timestamped, with anything that could identify a person or a business stripped out before it is recorded.",
      },
      {
        name: "Sign-in protection",
        benefit: "Somebody guessing passwords gets nowhere slowly",
        how: "Rate limits per account and per address, two-factor where you want it, and a sign-in trail kept for six months — long enough to investigate, short enough not to become a liability of its own.",
      },
      {
        name: "Tenant separation",
        benefit: "Your business's data is your business's",
        how: "Every query is scoped to the workspace, and an automated check on every build fails the build if a new one is not. That is a test in the repository, not a promise on a page.",
      },
    ],
  },

  // ------------------------------------------------------------------- AI
  {
    slug: "the-ai",
    label: "The AI",
    teaser: "Six officers watching the business, and a gate that stops them doing anything rash.",
    headline: "AI that can be trusted",
    headlineAccent: "with the keys",
    standfirst:
      "Every business tool now says it has AI. Almost all of it is a chat box bolted onto software that cannot actually do anything. The difference here is that the AI reaches the same functions the buttons do — and that a gate in the code, not a line in a prompt, decides what it may do without asking.",
    thesis:
      "An agent that could send an invoice unattended would be faster and completely untrustworthy. The value is in the restraint, and the restraint is enforced where a model cannot argue with it.",
    proof: [
      { n: "6", label: "officers watching the business: chief executive, finance, operations, sales, efficiency and compliance" },
      { n: "3", label: "AI providers supported — Anthropic, Google and OpenAI, chosen per workspace" },
      { n: "0", label: "money movements or customer messages that run without a person, at any autonomy setting" },
    ],
    features: [
      {
        name: "Six officers",
        benefit: "Somebody is watching the parts of the business you are not",
        how: "A finance officer watching margin and cash, an operations one watching empty running and stock turn, a sales one watching quotes going quiet, an efficiency one watching what the business is paying for twice, and a compliance one watching dates. Each says what it is watching and why it raised something.",
      },
      {
        name: "The autonomy gate",
        benefit: "The AI never does the thing you would not forgive",
        how: "Three settings — suggest only, do the reversible things, or run freely. No setting ever lets money move or a customer be contacted without a person. That is enforced in code from the tool's classification, never from what the model asserts about itself.",
      },
      {
        name: "Reasoning you can read",
        benefit: "You can tell whether it was right, not just what it did",
        how: "Every action shows what it looked at and why. An AI whose reasoning you cannot inspect is one you either over-trust or switch off, and both are failures.",
      },
      {
        name: "Undo",
        benefit: "A wrong call costs a click",
        how: "Actions the agent takes can be reversed, which is what makes it reasonable to let it act at all.",
      },
      {
        name: "Plain language",
        benefit: "You type what you want instead of learning where it lives",
        how: "Ask for a quote for a customer with three items and prices in your own words, and it resolves the customer, the products and the amounts, and shows you the draft.",
      },
      {
        name: "Voice and daily briefing",
        benefit: "The business tells you what needs attention before you open it",
        how: "A spoken rundown of what changed and what is due, and the ability to talk to it rather than type.",
      },
      {
        name: "Pick your provider",
        benefit: "You decide whose model reads your books",
        how: "Anthropic, Google or OpenAI, chosen per workspace by the owner and recorded in the audit trail — because it is a decision about where a business's own data goes, not a preference about output.",
      },
      {
        name: "Routed by task",
        benefit: "You are not paying frontier prices for bookkeeping",
        how: "Simple work goes to a fast model and hard work to a capable one, the tool list sent with each request is chosen by what was actually asked, and repeated context is cached. The bill is measured per run from real token counts, not estimated.",
      },
      {
        name: "Works through your own tools",
        benefit: "flow can be the engine under software you already use",
        how: "An API, webhooks and an MCP server, so another system can drive the same functions the dashboard does. For some businesses that is the whole product: keep the front end, replace what is underneath it.",
      },
    ],
  },

  // -------------------------------------------------------------- insight
  {
    slug: "knowing-where-you-stand",
    label: "Knowing where you stand",
    teaser: "Your own numbers, and — if you want it — where they sit against everybody else's.",
    headline: "Find out you are in the bottom quarter",
    headlineAccent: "while you can still move",
    standfirst:
      "Most businesses know their revenue and almost nothing else. They do not know their real margin, how long they actually take to get paid, how many quotes turn into work, or whether any of those numbers are normal for their trade — because there has never been anywhere to look.",
    thesis:
      "An average is dragged about by one outlier and tells a business almost nothing. Where you sit in the distribution is a sentence somebody can act on.",
    proof: [
      { n: "5", label: "businesses minimum before any comparison is reported — a cohort of two is one competitor reading the other" },
      { n: "0", label: "figures shared until a workspace opts in, and turning it off stops both immediately" },
      { n: "0", label: "businesses ever named in a comparison" },
    ],
    features: [
      {
        name: "How you compare",
        benefit: "You find out your margin is below the middle of your own trade",
        how: "Gross margin, how long invoices take to be paid, how many quotes turn into work, and average invoice — against businesses in the same trade. Reported as quartiles rather than an average, so the answer is where you sit rather than a number nobody is.",
        needs: "Opting in, which also adds your figures to the anonymous pool.",
      },
      {
        name: "Nothing below five",
        benefit: "Nobody can read your numbers out of a comparison",
        how: "Nothing is reported below five contributing businesses, and the floor is stated rather than silently applied — a comparison that quietly disappears looks like a bug.",
      },
      {
        name: "Margins per customer and per job",
        benefit: "The customer you like most is sometimes the one costing you",
        how: "True margin per customer, per job, per lane and per product, after the costs that actually attach to each.",
      },
      {
        name: "KPIs and dashboards",
        benefit: "The four numbers that matter, without building a report",
        how: "Headline figures on one screen, per business, with the metrics a trade actually watches rather than a generic set.",
      },
      {
        name: "What-if",
        benefit: "You can test a decision before you make it",
        how: "Change a price, a cost or a volume and see what it does to the figures you already have.",
      },
      {
        name: "Predictions",
        benefit: "You see the shape of next month",
        how: "From the invoices, bills, commitments and patterns that already exist — not from an optimistic assumption.",
      },
      {
        name: "Industry packs",
        benefit: "The software already knows what your trade watches",
        how: "A logistics operation watches empty running; a retailer watches stock turn. A pack changes which findings rank higher, which accounts the chart starts with, and what each officer says it is watching. Nothing is switched off — a retailer with a delivery van still hears about the van.",
      },
      {
        name: "Goals",
        benefit: "A target somebody set in January is still visible in June",
        how: "Goals with numbers and dates, measured from the work rather than from a status meeting.",
      },
      {
        name: "Load shedding",
        benefit: "Nobody drives to a job during a power cut",
        how: "No business software built anywhere else models this, and in South Africa it is the single largest thing shaping a working day. Scheduling a job into a block where the power is off is a wasted callout, a customer who waited in, and fuel burnt driving there.",
      },
    ],
  },
];

/** Every feature across every category, for counting and for search. */
export function allFeatures(): Feature[] {
  return FEATURE_CATEGORIES.flatMap((c) => c.features);
}

export function categoryBySlug(slug: string): FeatureCategory | undefined {
  return FEATURE_CATEGORIES.find((c) => c.slug === slug);
}
