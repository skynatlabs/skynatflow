// Connecting the mailbox somebody already has.
//
// Half the business world is a Microsoft shop and most of the rest is on
// Gmail, and until now connecting either meant knowing what imap.gmail.com is
// and which of four ports to use. That is not a setting a plumber should have
// to look up, and asking them to is why "connect your mail" is the step
// people stop at.
//
// So: the hosts and ports for the mailboxes people actually have, prefilled,
// with the one instruction that matters for each — which for both Google and
// Microsoft is that the password is not the password. Both require an app
// password with two-factor turned on, and a business that types its ordinary
// password gets a failure message from the mail server that explains nothing.
//
// OAuth is the better answer and is declared honestly as not built: it needs
// an app registration and a verification review per provider, neither of
// which is code. What is here works today.

export type MailAuth =
  /** Host, port, username and an app password. Works now, for everything. */
  | "app-password"
  /** A sign-in flow. Needs an app registration this build does not have. */
  | "oauth";

export interface MailProvider {
  key: string;
  label: string;
  auth: MailAuth;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** The one thing that will otherwise waste somebody an afternoon. */
  instruction: string;
  /** Where to go and make the app password. */
  helpUrl?: string;
}

export const MAIL_PROVIDERS: MailProvider[] = [
  {
    key: "gmail",
    label: "Gmail or Google Workspace",
    auth: "app-password",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    instruction:
      "Google will not accept your ordinary password. Turn on two-step verification, then make an app password and paste that here.",
    helpUrl: "https://myaccount.google.com/apppasswords",
  },
  {
    key: "microsoft",
    label: "Outlook, Hotmail or Microsoft 365",
    auth: "app-password",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    instruction:
      "Microsoft will not accept your ordinary password either. Turn on two-step verification, then create an app password. On a work account an administrator may have to allow IMAP first.",
    helpUrl: "https://account.microsoft.com/security",
  },
  {
    key: "zoho",
    label: "Zoho Mail",
    auth: "app-password",
    imapHost: "imap.zoho.com",
    imapPort: 993,
    smtpHost: "smtp.zoho.com",
    smtpPort: 465,
    smtpSecure: true,
    instruction: "Make an application-specific password under Security, and use your full address as the username.",
    helpUrl: "https://accounts.zoho.com/home#security",
  },
  {
    key: "yahoo",
    label: "Yahoo Mail",
    auth: "app-password",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpSecure: true,
    instruction: "Generate an app password under Account Security.",
    helpUrl: "https://login.yahoo.com/account/security",
  },
  {
    key: "cpanel",
    label: "Your own domain (cPanel, Plesk, a host)",
    auth: "app-password",
    imapHost: "mail.yourdomain.co.za",
    imapPort: 993,
    smtpHost: "mail.yourdomain.co.za",
    smtpPort: 465,
    smtpSecure: true,
    instruction:
      "Replace yourdomain with your own. Most hosts use mail.<your domain> for both, and your email address as the username — your host's control panel shows the exact settings if not.",
  },
  {
    key: "other",
    label: "Something else",
    auth: "app-password",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    instruction: "Your mail provider publishes these settings, usually under a page called IMAP or 'other mail apps'.",
  },
];

export const MAIL_PROVIDER_BY_KEY: Record<string, MailProvider> = Object.fromEntries(MAIL_PROVIDERS.map((p) => [p.key, p]));

/**
 * The provider a given address most likely belongs to.
 *
 * A guess, offered rather than applied — somebody on a custom domain hosted
 * by Google should be able to say so, and somebody whose domain happens to
 * contain "outlook" should not have it decided for them.
 */
export function guessProvider(emailAddress: string): MailProvider | null {
  const domain = emailAddress.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (/gmail\.com|googlemail\.com/.test(domain)) return MAIL_PROVIDER_BY_KEY.gmail;
  if (/outlook\.|hotmail\.|live\.|msn\.com|office365/.test(domain)) return MAIL_PROVIDER_BY_KEY.microsoft;
  if (/zoho\./.test(domain)) return MAIL_PROVIDER_BY_KEY.zoho;
  if (/yahoo\./.test(domain)) return MAIL_PROVIDER_BY_KEY.yahoo;
  return null;
}

/** Settings filled in for an address, ready to be shown in a form. */
export function settingsFor(emailAddress: string, providerKey?: string): MailProvider {
  const chosen = providerKey ? MAIL_PROVIDER_BY_KEY[providerKey] : null;
  const provider = chosen ?? guessProvider(emailAddress) ?? MAIL_PROVIDER_BY_KEY.other;
  if (provider.key !== "cpanel") return provider;

  // For a custom domain the best guess really is mail.<their domain>.
  const domain = emailAddress.split("@")[1];
  if (!domain) return provider;
  return { ...provider, imapHost: `mail.${domain}`, smtpHost: `mail.${domain}` };
}

/**
 * What the wider Microsoft and Google integrations would need.
 *
 * Kept as a statement rather than a half-built button, because an
 * integrations page that lies is worse than one that is short.
 */
export const DEEPER_INTEGRATIONS = [
  {
    key: "microsoft-365",
    label: "Microsoft 365 — calendar, contacts and Teams",
    needs: "An Azure app registration with delegated Graph permissions, and admin consent on a work tenant.",
  },
  {
    key: "google-workspace",
    label: "Google Workspace — Drive and Meet",
    needs: "A Google Cloud project with the Drive and Calendar scopes, and OAuth verification for anything beyond a test list.",
  },
] as const;
