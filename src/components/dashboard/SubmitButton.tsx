"use client";

// A plain <button type="submit"> stays clickable while its form action is
// running — on a slow connection, or just an anxious double-tap, that fires
// the action twice. For money-moving forms (payments, refunds, cash sales,
// POS checkout) that means a real duplicate transaction, not just a UI
// glitch. useFormStatus reports the enclosing <form>'s pending state, so
// this only works as a *child* of the <form> it should disable for.

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  className = "kb-pill kb-pill-primary text-xs",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:opacity-50`}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
