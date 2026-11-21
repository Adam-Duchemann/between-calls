import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { useScheduleDraft } from "./useScheduleDraft";

describe("explicit schedule save", () => {
  it("starts clean, tracks unsaved values, resets and advances its baseline only after save", () => {
    const { result } = renderHook(() => {
      const form = useForm({ defaultValues: { name: "Work", dateOverrides: [] as string[] } });
      return { form, ...useScheduleDraft(form) };
    });
    expect(result.current.hasChanges).toBe(false);
    act(() => result.current.form.setValue("dateOverrides", ["closed"]));
    expect(result.current.hasChanges).toBe(true);
    act(() => result.current.reset());
    expect(result.current.form.getValues("dateOverrides")).toEqual([]);
    act(() => result.current.form.setValue("name", "New hours"));
    const saved = result.current.form.getValues();
    act(() => result.current.saved(saved));
    expect(result.current.hasChanges).toBe(false);
    act(() => result.current.form.setValue("name", "Unsaved"));
    act(() => result.current.reset());
    expect(result.current.form.getValues("name")).toBe("New hours");
  });
  it("preserves edits made while a save is in flight", () => {
    const { result } = renderHook(() => {
      const form = useForm({ defaultValues: { name: "Work" } });
      return { form, ...useScheduleDraft(form) };
    });
    const submitted = result.current.form.getValues();
    act(() => result.current.form.setValue("name", "Later edit"));
    act(() => result.current.saved(submitted));
    expect(result.current.form.getValues("name")).toBe("Later edit");
    expect(result.current.hasChanges).toBe(true);
  });
});
