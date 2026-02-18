"use client";

/**
 * PasswordChecklist
 *
 * A reusable live-validation checklist for password requirements.
 * Matches modern UI pattern: green filled-circle checkmark when met,
 * gray circle with X when unmet. Single-column vertical layout.
 *
 * Usage:
 *   <PasswordChecklist
 *     hasMinLength={hasMinLength}
 *     hasNumber={hasNumber}
 *     hasSymbol={hasSymbol}
 *     hasUpperAndLower={hasUpperAndLower}
 *   />
 */

import { Check, X } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PasswordChecklistProps {
  hasMinLength: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
  hasUpperAndLower: boolean;
}

interface CheckItemProps {
  /** Whether this specific requirement is currently satisfied */
  met: boolean;
  /** Human-readable label for the requirement */
  label: string;
}

// ─── Single Rule Row ─────────────────────────────────────────────────────────

/**
 * CheckItem renders one validation rule with an animated icon.
 * Met   → green filled circle + white checkmark, green text
 * Unmet → gray circle + gray X, muted text
 */
function CheckItem({ met, label }: CheckItemProps) {
  return (
    <li
      className="flex items-center gap-2.5 text-[13px] transition-colors duration-300"
      aria-label={`${label}: ${met ? "requirement met" : "requirement not met"}`}
    >
      {/* Icon circle — smoothly transitions between met/unmet states */}
      <span
        className={`flex-shrink-0 h-[18px] w-[18px] rounded-full flex items-center justify-center transition-all duration-300 ${
          met
            ? "bg-[#388E3C] shadow-sm"               // filled green
            : "bg-gray-300"                           // gray fill
        }`}
        aria-hidden="true"
      >
        {met ? (
          <Check
            className="h-3 w-3 text-white transition-all duration-300 opacity-100 scale-100"
            strokeWidth={3}
          />
        ) : (
          <X
            className="h-3 w-3 text-white transition-all duration-300 opacity-100 scale-100"
            strokeWidth={3}
          />
        )}
      </span>

      <span className={`transition-colors duration-300 ${met ? "text-[#2E7D32] font-medium" : "text-gray-500"}`}>
        {label}
      </span>
    </li>
  );
}

// ─── Exported Checklist ──────────────────────────────────────────────────────

export function PasswordChecklist({
  hasMinLength,
  hasNumber,
  hasSymbol,
  hasUpperAndLower,
}: PasswordChecklistProps) {
  return (
    <ul
      role="list"
      aria-label="Password requirements"
      className="flex flex-col gap-2 mt-3"
    >
      <CheckItem met={hasMinLength}     label="Password must be over 8 characters" />
      <CheckItem met={hasNumber}        label="Password must contain 1 number" />
      <CheckItem met={hasSymbol}        label="Password must contain 1 special character" />
      <CheckItem met={hasUpperAndLower} label="Password must contain 1 upper case and 1 lower case letter" />
    </ul>
  );
}
