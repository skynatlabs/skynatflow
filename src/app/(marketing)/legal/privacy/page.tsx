import type { Metadata } from "next";
import { LegalPage } from "../LegalPage";
import { LAST_UPDATED, PRIVACY } from "../content";

export const metadata: Metadata = {
  title: "Privacy — skynat.ai",
  description: "What we hold, why, who else sees it, and how long we keep it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      standfirst="What we hold, why we hold it, who else sees it, and how long it stays."
      clauses={PRIVACY}
      lastUpdated={LAST_UPDATED}
    />
  );
}
