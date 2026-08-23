"use client";

// Scroll-triggered reveal used to wrap every marketing section — a spring
// (not a linear ease) is what actually reads as "elastic": it overshoots
// slightly and settles, rather than just fading in flatly.

import { motion } from "motion/react";

export default function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ type: "spring", stiffness: 140, damping: 18, delay }}
    >
      {children}
    </motion.div>
  );
}
