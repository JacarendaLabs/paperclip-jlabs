import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Styling matches the bare inputs on the auth page rather than ui/input.tsx,
// so the login form stays visually one piece.
const FIELD_CLASS =
  "w-full rounded-md border border-border bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50";

export type PasswordFieldProps = Omit<ComponentProps<"input">, "type">;

/**
 * A password input with a reveal toggle.
 *
 * Reveal is deliberately component-local state that starts false on every
 * mount: it is never persisted and never lifted, so no stored preference can
 * leave a password on screen for the next person at the keyboard.
 */
export function PasswordField({ className, ...props }: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const label = revealed ? "Hide password" : "Show password";

  return (
    <div className="relative">
      <input
        {...props}
        type={revealed ? "text" : "password"}
        className={cn(FIELD_CLASS, className)}
      />
      <button
        // Not a submit button: inside a <form> the default type would submit it.
        type="button"
        onClick={() => setRevealed((current) => !current)}
        aria-pressed={revealed}
        aria-label={label}
        title={label}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
      >
        {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
