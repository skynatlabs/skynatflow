"use client";

// Pipeline stage pills pop in one after another with a springy overshoot —
// this is the one spot on the industry pages where "elastic" is literal,
// not just a fade.

import { motion } from "motion/react";
import Reveal from "@/components/marketing/Reveal";

export default function PipelinePreview({
  label,
  stages,
}: {
  label: string;
  stages: { key: string; label: string }[];
}) {
  return (
    <Reveal>
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-center text-3xl font-extrabold text-[var(--kb-text)]">
          Your {label.toLowerCase()} pipeline, out of the box
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {stages.map((stage, i) => (
            <div key={stage.key} className="flex items-center gap-2">
              <motion.span
                className="kb-pill kb-pill-ghost"
                initial={{ opacity: 0, scale: 0.5 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ type: "spring", stiffness: 300, damping: 12, delay: i * 0.08 }}
              >
                {stage.label}
              </motion.span>
              {i < stages.length - 1 && (
                <span className="text-[var(--kb-text-dim)]">&rarr;</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
