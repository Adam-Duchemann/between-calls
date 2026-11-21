"use client";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import Link from "next/link";
export default function Credits() {
  const { t } = useLocale();
  return (
    <Link
      href="/settings/my-account/about"
      className="text-subtle mx-3 mb-2 mt-1 hidden text-xs hover:underline lg:block">
      {t("about")}
    </Link>
  );
}
