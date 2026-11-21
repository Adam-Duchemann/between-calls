"use client";

import { type BookingPageAppearance, contrastRatio } from "@calcom/prisma/bookingPageAppearanceSchema";
import { Logo } from "@calcom/ui/components/logo";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo } from "react";
import "./BookingPageTheme.css";

export function bookingAppearanceVariables(appearance: BookingPageAppearance): Record<string, string> {
  const { accent, background, surface, text, headingFont, corners } = appearance;
  const contrastText =
    contrastRatio(accent, "#FFFFFF") >= contrastRatio(accent, "#000000") ? "#FFFFFF" : "#000000";
  const muted = `color-mix(in srgb, ${accent} 10%, ${surface})`;
  const border = `color-mix(in srgb, ${text} 22%, ${surface})`;
  return {
    "--cal-bg": surface,
    "--cal-bg-subtle": background,
    "--cal-bg-muted": surface,
    "--cal-bg-emphasis": muted,
    "--cal-bg-inverted": accent,
    "--cal-bg-primary": accent,
    "--cal-bg-primary-emphasis": accent,
    "--cal-bg-primary-muted": muted,
    "--cal-bg-brand": accent,
    "--cal-bg-brand-emphasis": accent,
    "--cal-bg-brand-muted": muted,
    "--cal-brand": accent,
    "--cal-brand-emphasis": accent,
    "--cal-brand-subtle": muted,
    "--cal-brand-text": contrastText,
    "--cal-brand-accent": contrastText,
    "--cal-text": text,
    "--cal-text-emphasis": text,
    "--cal-text-subtle": `color-mix(in srgb, ${text} 80%, ${surface})`,
    "--cal-text-muted": `color-mix(in srgb, ${text} 65%, ${surface})`,
    "--cal-text-inverted": contrastText,
    "--cal-border": border,
    "--cal-border-subtle": border,
    "--cal-border-muted": border,
    "--cal-border-emphasis": accent,
    "--cal-booking-heading-font":
      headingFont === "serif"
        ? 'Georgia, "Times New Roman", serif'
        : '"Helvetica Neue", Helvetica, Arial, sans-serif',
    "--cal-booking-radius": corners === "sharp" ? "3px" : corners === "soft" ? "10px" : "20px",
    "--cal-booking-background": background,
  };
}

export function BookingPageTheme({
  appearance,
  children,
  documentTheme = false,
}: {
  appearance?: BookingPageAppearance | null;
  children: ReactNode;
  documentTheme?: boolean;
}) {
  const variables = useMemo(
    () => (appearance?.enabled ? bookingAppearanceVariables(appearance) : null),
    [appearance]
  );
  useEffect(() => {
    if (!documentTheme || !variables || !appearance) return;
    // Body scope reaches dialog portals; cleanup keeps dashboard styling independent.
    const body = document.body;
    const styles = { ...variables, "background-color": appearance.background, color: appearance.text };
    const previous = Object.keys(styles).map((key) => [
      key,
      body.style.getPropertyValue(key),
      body.style.getPropertyPriority(key),
    ]);
    const marker = body.getAttribute("data-cal-booking-theme");
    for (const [key, value] of Object.entries(styles)) body.style.setProperty(key, value);
    body.setAttribute("data-cal-booking-theme", "true");
    return () => {
      for (const [key, value, priority] of previous) {
        if (value) body.style.setProperty(key, value, priority);
        else body.style.removeProperty(key);
      }
      if (marker === null) body.removeAttribute("data-cal-booking-theme");
      else body.setAttribute("data-cal-booking-theme", marker);
    };
  }, [appearance, documentTheme, variables]);
  if (!variables) return <>{children}</>;
  return (
    <div
      className={`cal-booking-theme${documentTheme ? " cal-booking-theme-canvas" : ""}`}
      style={variables as CSSProperties}>
      {children}
    </div>
  );
}

export function BookingPageBrand({ appearance }: { appearance?: BookingPageAppearance | null }) {
  if (!appearance?.enabled)
    return (
      <a
        href={process.env.NEXT_PUBLIC_WEBSITE_URL || "/"}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4">
        <Logo />
      </a>
    );
  const brand = (
    <span className="cal-booking-brand">
      {appearance.logoUrl && <img src={appearance.logoUrl} alt="" className="cal-booking-logo" />}
      <span>{appearance.brandName}</span>
    </span>
  );
  return appearance.websiteUrl ? (
    <a href={appearance.websiteUrl} target="_blank" rel="noreferrer" className="cal-booking-brand-link">
      {brand}
    </a>
  ) : (
    brand
  );
}
