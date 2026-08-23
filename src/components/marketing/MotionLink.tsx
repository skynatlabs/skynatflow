"use client";

// Elastic hover/tap on marketing CTAs — a spring scale reads as bouncy in a
// way a CSS transition alone doesn't. Scoped to the marketing site only
// (dashboard buttons are untouched).

import Link from "next/link";
import { motion } from "motion/react";

const MotionLink = motion.create(Link);

export default MotionLink;
