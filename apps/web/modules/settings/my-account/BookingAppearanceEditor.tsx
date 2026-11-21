"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import {
  TEAL_BOOKING_APPEARANCE,
  type BookingPageAppearance,
  bookingPageAppearanceSchema,
} from "@calcom/prisma/bookingPageAppearanceSchema";
import { useEffect, useState } from "react";
import { BookingPageBrand, BookingPageTheme } from "../../bookings/components/appearance/BookingPageTheme";

const initialAppearance = (value?: BookingPageAppearance | null): BookingPageAppearance =>
  value ?? { ...TEAL_BOOKING_APPEARANCE, enabled: false };
const inputClass = "border-default bg-default text-default w-full rounded-md border px-3 py-2 text-sm";
const buttonClass = "border-default text-default rounded-md border px-3 py-2 text-sm disabled:opacity-40";

export function BookingAppearanceEditor({
  value,
  onSave,
  onImport,
  hostName,
}: {
  value?: BookingPageAppearance | null;
  hostName?: string | null;
  onSave: (appearance: BookingPageAppearance) => Promise<void>;
  onImport?: (url: string) => Promise<Partial<BookingPageAppearance>>;
}) {
  const { t } = useLocale();
  const [saved, setSaved] = useState(() => initialAppearance(value));
  const [draft, setDraft] = useState(saved);
  const [sourceUrl, setSourceUrl] = useState(saved.websiteUrl);
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const parsed = bookingPageAppearanceSchema.safeParse(draft);
  const preview = parsed.success ? parsed.data : saved;
  useEffect(() => {
    if (dirty) return;
    const current = initialAppearance(value);
    setSaved(current);
    setDraft(current);
  }, [value]);
  const update = <K extends keyof BookingPageAppearance>(key: K, next: BookingPageAppearance[K]) => {
    setDraft((current) => ({ ...current, [key]: next }));
    setError("");
  };

  return (
    <section className="border-subtle my-6 rounded-xl border" aria-labelledby="booking-design-title">
      <header className="border-subtle space-y-2 border-b p-6">
        <h2 id="booking-design-title" className="text-emphasis text-lg font-semibold">
          {t("booking_appearance_title")}
        </h2>
        <p className="text-subtle text-sm">{t("booking_appearance_description")}</p>
      </header>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!parsed.success || busy) return;
          setBusy(true);
          setError("");
          try {
            await onSave(parsed.data);
            setSaved(parsed.data);
            setDraft(parsed.data);
          } catch {
            setError("booking_appearance_save_error");
          } finally {
            setBusy(false);
          }
        }}>
        <div className="grid gap-6 p-6 xl:grid-cols-[minmax(240px,1fr)_minmax(0,1.5fr)]">
          <div className="space-y-5">
            <label className="text-default flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={busy}
                onChange={(e) => update("enabled", e.target.checked)}
              />
              {t("booking_appearance_enable")}
            </label>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                setDraft({ ...TEAL_BOOKING_APPEARANCE });
                setError("");
              }}>
              {t("booking_appearance_teal_preset")}
            </button>
            {onImport && (
              <div className="space-y-2">
                <label className="text-default block text-sm" htmlFor="booking-source-url">
                  {t("booking_appearance_source")}
                </label>
                <input
                  id="booking-source-url"
                  className={inputClass}
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://example.com"
                  disabled={busy}
                />
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !sourceUrl}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const suggestion = await onImport(sourceUrl);
                      const next = bookingPageAppearanceSchema.parse({
                        ...draft,
                        ...suggestion,
                        enabled: true,
                      });
                      setDraft(next);
                    } catch {
                      setError("booking_appearance_import_error");
                    } finally {
                      setBusy(false);
                    }
                  }}>
                  {t("booking_appearance_import")}
                </button>
                <p className="text-subtle text-xs">{t("booking_appearance_import_note")}</p>
              </div>
            )}
            <fieldset disabled={busy || !draft.enabled} className="space-y-4 disabled:opacity-50">
              {(["brandName", "logoUrl", "websiteUrl"] as const).map((key) => (
                <label key={key} className="text-default block space-y-1 text-sm">
                  <span>
                    {t(
                      `booking_appearance_${key === "brandName" ? "brand_name" : key === "logoUrl" ? "logo" : "website"}`
                    )}
                  </span>
                  <input
                    className={inputClass}
                    value={draft[key]}
                    onChange={(e) => update(key, e.target.value)}
                    maxLength={key === "brandName" ? 80 : 2048}
                  />
                </label>
              ))}
              <div className="grid grid-cols-2 gap-3">
                {(["background", "surface", "accent", "text"] as const).map((key) => (
                  <label key={key} className="text-default block space-y-1 text-sm">
                    <span>{t(`booking_appearance_${key}`)}</span>
                    <input
                      className="border-default h-10 w-full cursor-pointer rounded-md border p-1"
                      type="color"
                      value={draft[key]}
                      onChange={(e) => update(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <label className="text-default block space-y-1 text-sm">
                <span>{t("booking_appearance_font")}</span>
                <select
                  className={inputClass}
                  value={draft.headingFont}
                  onChange={(e) => update("headingFont", e.target.value === "serif" ? "serif" : "sans")}>
                  <option value="serif">{t("booking_appearance_serif")}</option>
                  <option value="sans">{t("booking_appearance_sans")}</option>
                </select>
              </label>
              <label className="text-default block space-y-1 text-sm">
                <span>{t("booking_appearance_corners")}</span>
                <select
                  className={inputClass}
                  value={draft.corners}
                  onChange={(e) =>
                    update(
                      "corners",
                      e.target.value === "sharp" ? "sharp" : e.target.value === "round" ? "round" : "soft"
                    )
                  }>
                  {(["sharp", "soft", "round"] as const).map((corner) => (
                    <option key={corner} value={corner}>
                      {t(`booking_appearance_${corner}`)}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-subtle text-xs">{t("booking_appearance_preview")}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={buttonClass}
                  aria-pressed={!mobile}
                  onClick={() => setMobile(false)}>
                  {t("booking_appearance_desktop")}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  aria-pressed={mobile}
                  onClick={() => setMobile(true)}>
                  {t("booking_appearance_mobile")}
                </button>
              </div>
            </div>
            <div
              className="border-subtle mx-auto overflow-hidden rounded-xl border"
              style={{ maxWidth: mobile ? 375 : "100%" }}>
              <BookingPageTheme appearance={preview}>
                <div className="space-y-6 p-4 sm:p-6">
                  <div className="flex justify-center">
                    <BookingPageBrand appearance={preview} />
                  </div>
                  <div
                    data-testid="booker-container"
                    className={`bg-default border-subtle grid border ${mobile ? "" : "sm:grid-cols-2"}`}>
                    <div className="space-y-3 p-4">
                      <p className="text-subtle text-xs">{hostName || t("booking_appearance_sample_host")}</p>
                      <h1 data-testid="event-title">{t("booking_appearance_sample_meeting")}</h1>
                      <p className="text-subtle text-sm">30 min · Google Meet</p>
                    </div>
                    <div className="border-subtle space-y-4 border-t p-4">
                      <p className="text-default text-sm font-semibold">
                        {t("booking_appearance_sample_month")}
                      </p>
                      <div className="grid grid-cols-7 gap-1" aria-hidden="true">
                        {Array.from({ length: 28 }, (_, i) => (
                          <span
                            key={i}
                            className={`rounded-md p-1 text-center text-xs ${i === 15 ? "bg-inverted text-inverted" : i > 14 && i < 20 ? "bg-emphasis text-default" : "text-subtle"}`}>
                            {i + 1}
                          </span>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {["09:00", "11:30", "14:15", "16:00"].map((time) => (
                          <span
                            key={time}
                            className="border-subtle text-default rounded-md border p-2 text-center text-xs">
                            {time}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </BookingPageTheme>
            </div>
          </div>
        </div>
        {(!parsed.success || error) && (
          <p role="alert" className="text-error px-6 pb-4 text-sm">
            {t(error || parsed.error?.issues[0]?.message || "booking_appearance_invalid")}
          </p>
        )}
        <footer className="border-subtle flex justify-end gap-2 border-t p-4">
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !dirty}
            onClick={() => {
              setDraft(saved);
              setError("");
            }}>
            {t("reset")}
          </button>
          <button
            type="submit"
            className="bg-inverted text-inverted rounded-md px-4 py-2 text-sm disabled:opacity-40"
            disabled={busy || !dirty || !parsed.success}>
            {t("save")}
          </button>
        </footer>
      </form>
    </section>
  );
}
