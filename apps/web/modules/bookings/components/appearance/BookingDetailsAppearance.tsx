"use client";

import type { BookingPageAppearance } from "@calcom/prisma/bookingPageAppearanceSchema";
import type { ReactNode } from "react";
import { BookingPageBrand, BookingPageTheme } from "./BookingPageTheme";

export function BookingDetailsAppearance({
  appearance,
  isEmbed,
  isHostView,
  hideBranding,
  children,
}: {
  appearance?: BookingPageAppearance | null;
  isEmbed: boolean;
  isHostView: boolean;
  hideBranding: boolean;
  children: ReactNode;
}) {
  const content = (
    <div className={isEmbed ? "" : "h-screen"} data-testid="success-page">
      {children}
    </div>
  );
  if (isEmbed || isHostView || !appearance?.enabled) return content;
  return (
    <BookingPageTheme appearance={appearance} documentTheme>
      {!hideBranding && (
        <header className="flex w-full justify-center px-4 pt-8">
          <BookingPageBrand appearance={appearance} />
        </header>
      )}
      {content}
    </BookingPageTheme>
  );
}
