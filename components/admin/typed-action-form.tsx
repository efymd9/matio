"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import type { AdminFormState } from "@/app/admin/actions";

// A <form> for a server action that RETURNS AdminFormState instead of
// throwing. The fields stay in the server page and arrive as children —
// this wrapper only owns the three things that need the client: the
// action state, the inline error banner, and the submit lock.
//
// Manual dispatch instead of action={formAction}: React 19 resets every
// uncontrolled field to its defaultValue when a <form action> completes,
// INCLUDING when the action returns a validation error, so the admin's
// typed values would vanish along with the explanation. Dispatching
// through useActionState inside our own transition schedules no reset —
// the same pattern (and the same reason) as components/admin/show-form.
// Native constraint validation still runs before submit fires.
//
// The caller's layout classes go on the FIELDSET, not the form: Tailwind
// compiles space-y-* to a direct-child selector, and wrapping the fields
// in anything would otherwise make them grandchildren and collapse every
// gap. min-w-0 undoes the fieldset's own min-inline-size:min-content, which
// would keep the grid rows inside from shrinking.
const PendingContext = createContext(false);

/** Pending state of the enclosing TypedActionForm. False everywhere else,
 *  so a button can read it next to useFormStatus without caring which kind
 *  of form it sits in. */
export function useTypedActionPending(): boolean {
  return useContext(PendingContext);
}

export function TypedActionForm({
  action,
  className,
  resetOnSuccess = false,
  children,
}: {
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  className?: string;
  /** Create forms clear themselves after a successful insert; edit forms
   *  must keep what the admin just saved. */
  resetOnSuccess?: boolean;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    action,
    { status: "idle" },
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.status === "ok") formRef.current?.reset();
  }, [resetOnSuccess, state]);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        // Read the fields BEFORE the fieldset goes disabled — a disabled
        // control contributes nothing to FormData.
        const formData = new FormData(e.currentTarget);
        startTransition(() => formAction(formData));
      }}
      aria-busy={pending}
    >
      <PendingContext.Provider value={pending}>
        {/* disabled while in flight: a second submit would otherwise race
            the first and come back as "number taken" for the row it just
            inserted. */}
        <fieldset
          disabled={pending}
          className={className ? `min-w-0 ${className}` : "min-w-0"}
        >
          <FormErrorBanner state={state} />
          {children}
        </fieldset>
      </PendingContext.Provider>
    </form>
  );
}
