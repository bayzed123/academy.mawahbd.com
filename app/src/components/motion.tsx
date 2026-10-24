import { LazyMotion, m, useReducedMotion } from "framer-motion";
import { useState, type ReactNode } from "react";

/*
 * Framer Motion in the student app: sections and cards fade in and rise 20px as they come into view ({ opacity: 0, y: 20 } →
 * { opacity: 1, y: 0 }, 0.5 s, ease-out), the cards of a list one after another. Its animation features load in their own small file
 * as soon as the app starts, so the first screen stays as light as before. Whatever is drawn before they arrive, and everything for a
 * visitor who asked for less motion, is simply there: nothing waits on them, and nothing can stay hidden if they never arrive.
 */
let ready = false;
const loading = import("./motion-features").then((r) => {
  ready = true;
  return r.default;
});
loading.catch(() => {});

export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={() => loading} strict>
      {children}
    </LazyMotion>
  );
}

/** A block that rises into view (once). `delay` staggers the cards of a list; the hover of what is inside stays its own (CSS). */
export function Reveal({ delay = 0, className = "reveal", children }: { delay?: number; className?: string; children: ReactNode }) {
  const still = useReducedMotion();
  // decided once, when the block first appears: switching later would draw it twice
  const [animated] = useState(() => ready && !still);
  if (!animated) return <div className={className}>{children}</div>;
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </m.div>
  );
}

/** The delay of the i-th card of a list: 0.08 s apart, never more than 0.4 s after the first. */
export const stagger = (i: number) => Math.min(i * 0.08, 0.4);
