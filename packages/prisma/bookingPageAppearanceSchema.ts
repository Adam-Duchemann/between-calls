import { z } from "zod";

const colour = z.string().regex(/^#[0-9a-f]{6}$/i);
const httpsUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  });

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const bookingPageAppearanceSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    background: colour,
    surface: colour,
    accent: colour,
    text: colour,
    headingFont: z.enum(["sans", "serif"]),
    corners: z.enum(["sharp", "soft", "round"]),
    brandName: z.string().trim().min(1).max(80),
    logoUrl: z.union([z.literal("/cal-com-icon.svg"), httpsUrl]),
    websiteUrl: httpsUrl,
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const background of [value.background, value.surface]) {
      if (contrastRatio(value.text, background) < 4.5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["text"],
          message: "booking_appearance_text_contrast",
        });
        break;
      }
    }
    if (contrastRatio(value.accent, value.surface) < 4.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accent"],
        message: "booking_appearance_accent_contrast",
      });
    }
  });

export type BookingPageAppearance = z.infer<typeof bookingPageAppearanceSchema>;

export const TEAL_BOOKING_APPEARANCE: BookingPageAppearance = {
  version: 1,
  enabled: true,
  background: "#F6F3EC",
  surface: "#FFFDF8",
  accent: "#176B68",
  text: "#292923",
  headingFont: "serif",
  corners: "soft",
  brandName: "Between Calls",
  logoUrl: "/cal-com-icon.svg",
  websiteUrl: "",
};
