import type { Metadata } from "next";
import { LegalPage } from "../LegalPage";
import { LAST_UPDATED, TERMS } from "../content";

export const metadata: Metadata = {
  title: "Terms of service — skynat.ai",
  description: "What you get, what you owe, and what happens if you leave.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      standfirst="What the service is, what each side is responsible for, and what happens when it ends."
      clauses={TERMS}
      lastUpdated={LAST_UPDATED}
    />
  );
}
