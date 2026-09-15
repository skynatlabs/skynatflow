// The words on a document, in the language the customer reads.
//
// South Africa has eleven official languages and business software has one.
// A quote in isiZulu is not a translation feature — it is the difference
// between a customer who understands what they are agreeing to and one who
// nods and signs, and it is something no competitor in this market bothers
// with.
//
// Deliberately a fixed vocabulary rather than machine translation. A document
// has perhaps thirty words on it that are not the customer's own — Quote,
// Total, VAT, Due — and getting those right in six languages is a table
// somebody can check. Sending a legally operative document through a
// translation model and hoping is a different risk entirely, and not one
// worth taking for thirty words.
//
// Free text the business wrote — item descriptions, scope of work, terms —
// is never touched. It goes out exactly as written, because rewriting what
// somebody committed to in a contract is not translation, it is alteration.

export const DOCUMENT_LANGUAGES = {
  en: "English",
  af: "Afrikaans",
  zu: "isiZulu",
  xh: "isiXhosa",
  st: "Sesotho",
  tn: "Setswana",
} as const;

export type DocumentLanguage = keyof typeof DOCUMENT_LANGUAGES;

export const DEFAULT_LANGUAGE: DocumentLanguage = "en";

export function isDocumentLanguage(value: unknown): value is DocumentLanguage {
  return typeof value === "string" && value in DOCUMENT_LANGUAGES;
}

/** Every label a generated document needs. */
export interface DocumentStrings {
  quote: string;
  invoice: string;
  statement: string;
  deliveryNote: string;
  billTo: string;
  from: string;
  date: string;
  dueDate: string;
  reference: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  subtotal: string;
  discount: string;
  vat: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  bankDetails: string;
  accountName: string;
  accountNumber: string;
  branchCode: string;
  terms: string;
  signature: string;
  thankYou: string;
  page: string;
}

const STRINGS: Record<DocumentLanguage, DocumentStrings> = {
  en: {
    quote: "Quote",
    invoice: "Invoice",
    statement: "Statement",
    deliveryNote: "Delivery note",
    billTo: "Bill to",
    from: "From",
    date: "Date",
    dueDate: "Due date",
    reference: "Reference",
    description: "Description",
    quantity: "Qty",
    unitPrice: "Unit price",
    amount: "Amount",
    subtotal: "Subtotal",
    discount: "Discount",
    vat: "VAT",
    total: "Total",
    amountPaid: "Amount paid",
    balanceDue: "Balance due",
    bankDetails: "Banking details",
    accountName: "Account name",
    accountNumber: "Account number",
    branchCode: "Branch code",
    terms: "Terms",
    signature: "Signature",
    thankYou: "Thank you for your business",
    page: "Page",
  },
  af: {
    quote: "Kwotasie",
    invoice: "Faktuur",
    statement: "Staat",
    deliveryNote: "Afleweringsnota",
    billTo: "Faktureer aan",
    from: "Van",
    date: "Datum",
    dueDate: "Vervaldatum",
    reference: "Verwysing",
    description: "Beskrywing",
    quantity: "Hoev.",
    unitPrice: "Eenheidsprys",
    amount: "Bedrag",
    subtotal: "Subtotaal",
    discount: "Afslag",
    vat: "BTW",
    total: "Totaal",
    amountPaid: "Bedrag betaal",
    balanceDue: "Balans verskuldig",
    bankDetails: "Bankbesonderhede",
    accountName: "Rekeningnaam",
    accountNumber: "Rekeningnommer",
    branchCode: "Takkode",
    terms: "Voorwaardes",
    signature: "Handtekening",
    thankYou: "Dankie vir u besigheid",
    page: "Bladsy",
  },
  zu: {
    quote: "Isilinganiso",
    invoice: "I-invoyisi",
    statement: "Isitatimende",
    deliveryNote: "Inothi lokulethwa",
    billTo: "Khokhisa ku",
    from: "Kusuka ku",
    date: "Usuku",
    dueDate: "Usuku lokukhokha",
    reference: "Inkomba",
    description: "Incazelo",
    quantity: "Inani",
    unitPrice: "Intengo nganye",
    amount: "Imali",
    subtotal: "Isamba esincane",
    discount: "Isaphulelo",
    vat: "I-VAT",
    total: "Isamba",
    amountPaid: "Imali ekhokhiwe",
    balanceDue: "Imali esasele",
    bankDetails: "Imininingwane yebhange",
    accountName: "Igama le-akhawunti",
    accountNumber: "Inombolo ye-akhawunti",
    branchCode: "Ikhodi yegatsha",
    terms: "Imibandela",
    signature: "Isayino",
    thankYou: "Siyabonga ngebhizinisi lakho",
    page: "Ikhasi",
  },
  xh: {
    quote: "Uxabiso",
    invoice: "I-invoyisi",
    statement: "Ingxelo",
    deliveryNote: "Inqaku lokuhanjiswa",
    billTo: "Bhatalisa ku",
    from: "Ukusuka ku",
    date: "Umhla",
    dueDate: "Umhla wokubhatala",
    reference: "Isalathiso",
    description: "Inkcazo",
    quantity: "Inani",
    unitPrice: "Ixabiso ngalinye",
    amount: "Imali",
    subtotal: "Isambuko esincinci",
    discount: "Isaphulelo",
    vat: "I-VAT",
    total: "Isambuko",
    amountPaid: "Imali ehlawulweyo",
    balanceDue: "Imali eseleyo",
    bankDetails: "Iinkcukacha zebhanki",
    accountName: "Igama le-akhawunti",
    accountNumber: "Inombolo ye-akhawunti",
    branchCode: "Ikhowudi yesebe",
    terms: "Imiqathango",
    signature: "Utyikityo",
    thankYou: "Enkosi ngoshishino lwakho",
    page: "Iphepha",
  },
  st: {
    quote: "Khoutu",
    invoice: "Invoicha",
    statement: "Setatemente",
    deliveryNote: "Lengolo la thomello",
    billTo: "Lefisa ho",
    from: "Ho tswa ho",
    date: "Letsatsi",
    dueDate: "Letsatsi la tefo",
    reference: "Sesupo",
    description: "Tlhaloso",
    quantity: "Palo",
    unitPrice: "Theko ka nngwe",
    amount: "Chelete",
    subtotal: "Kakaretso e nyane",
    discount: "Theolelo",
    vat: "VAT",
    total: "Kakaretso",
    amountPaid: "Chelete e lefilweng",
    balanceDue: "Chelete e setseng",
    bankDetails: "Dintlha tsa banka",
    accountName: "Lebitso la akhaonto",
    accountNumber: "Nomoro ya akhaonto",
    branchCode: "Khoutu ya lekala",
    terms: "Dipehelo",
    signature: "Tshaeno",
    thankYou: "Re leboha kgwebo ya hao",
    page: "Leqephe",
  },
  tn: {
    quote: "Khouto",
    invoice: "Invoisi",
    statement: "Setatamente",
    deliveryNote: "Lokwalo lwa thomelo",
    billTo: "Duelisa go",
    from: "Go tswa go",
    date: "Letlha",
    dueDate: "Letlha la tuelo",
    reference: "Tshupo",
    description: "Tlhaloso",
    quantity: "Palo",
    unitPrice: "Tlhwatlhwa ka nngwe",
    amount: "Madi",
    subtotal: "Palogotlhe e nnye",
    discount: "Phokotso",
    vat: "VAT",
    total: "Palogotlhe",
    amountPaid: "Madi a a duetsweng",
    balanceDue: "Madi a a setseng",
    bankDetails: "Dintlha tsa banka",
    accountName: "Leina la akhaonto",
    accountNumber: "Nomoro ya akhaonto",
    branchCode: "Khouto ya lekala",
    terms: "Dipeelo",
    signature: "Tshaeno",
    thankYou: "Re leboga kgwebo ya gago",
    page: "Tsebe",
  },
};

/**
 * The labels for a language.
 *
 * Falls back to English for anything unrecognised rather than throwing — a
 * document must always render, and a customer seeing English labels is a far
 * smaller problem than a quote that fails to generate.
 */
export function documentStrings(language: string | null | undefined): DocumentStrings {
  return isDocumentLanguage(language) ? STRINGS[language] : STRINGS[DEFAULT_LANGUAGE];
}

export function languageName(code: string | null | undefined): string {
  return isDocumentLanguage(code) ? DOCUMENT_LANGUAGES[code] : DOCUMENT_LANGUAGES[DEFAULT_LANGUAGE];
}

/**
 * The instruction given to the model when it drafts a message to this
 * customer.
 *
 * Unlike document labels, a message is free prose and genuinely is a
 * translation job — but the instruction is explicit that money, dates and
 * reference numbers stay in the format the customer's bank will recognise,
 * because a beautifully translated amount in the wrong numeral format is
 * worse than English.
 */
export function messageLanguagePrompt(language: string | null | undefined): string {
  if (!isDocumentLanguage(language) || language === "en") return "";
  return (
    `Write this in ${DOCUMENT_LANGUAGES[language]}, the language this customer reads. ` +
    `Keep amounts, dates, reference numbers and the business's own name exactly as given — ` +
    `translate the words around them, never the figures themselves. If you are not confident ` +
    `of a term, use the English word rather than guessing at one.`
  );
}
