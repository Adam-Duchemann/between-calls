import { useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";

export function useScheduleDraft<T extends FieldValues>(form: UseFormReturn<T>) {
  const [baseline, setBaseline] = useState(() => form.getValues());
  const values = useWatch({ control: form.control });
  return {
    hasChanges: JSON.stringify(values) !== JSON.stringify(baseline),
    reset: () => form.reset(baseline),
    saved: (submitted: T) => setBaseline(submitted),
  };
}
