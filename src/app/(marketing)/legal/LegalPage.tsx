// One layout for every legal page, so terms and privacy cannot drift apart
// in how they read. Plain prose, generous measure, no marketing furniture —
// somebody reading this is checking something, not being sold to.

import type { Clause } from "./content";

export function LegalPage({
  title,
  standfirst,
  clauses,
  lastUpdated,
}: {
  title: string;
  standfirst: string;
  clauses: Clause[];
  lastUpdated: string;
}) {
  return (
    <section className="section">
      <div className="wrap" style={{ maxWidth: "48rem" }}>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1.05, margin: "0 0 12px" }}>{title}</h1>
        <p style={{ opacity: 0.75, margin: "0 0 4px" }}>{standfirst}</p>
        <p style={{ opacity: 0.55, fontSize: "0.85rem", margin: "0 0 32px" }}>Last updated {lastUpdated}</p>

        {clauses.map((clause) => (
          <div key={clause.heading} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 8px" }}>{clause.heading}</h2>
            {clause.body.map((paragraph) => (
              <p key={paragraph.slice(0, 40)} style={{ margin: "0 0 10px", lineHeight: 1.65 }}>
                {paragraph}
              </p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
