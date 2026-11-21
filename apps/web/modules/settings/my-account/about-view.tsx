"use client";
import { APP_NAME, CALCOM_VERSION } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Logo } from "@calcom/ui/components/logo";
export const UPSTREAM_LICENSE =
  'MIT License\n\nCopyright (c) 2020-present Cal.com, Inc.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n';
export default function AboutView() {
  const { t } = useLocale();
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-3">
        <Logo />
        <h1 className="text-emphasis text-xl font-semibold">{t("about")}</h1>
        <p className="text-subtle">{t("cal_about_description", { appName: APP_NAME })}</p>
      </header>
      <a className="text-emphasis inline-block underline" href="/settings/my-account/about/review">
        {t("cal_information_review_link")}
      </a>
      <div className="border-subtle rounded-xl border p-5">
        <h2 className="text-emphasis mb-3 font-semibold">{t("cal_about_credits")}</h2>
        <p className="text-default">
          {t("cal_about_based_on")}{" "}
          <a className="underline" href="https://github.com/calcom/cal.diy" target="_blank" rel="noreferrer">
            Cal.diy
          </a>{" "}
          · {CALCOM_VERSION}
        </p>
        <p className="text-subtle mt-2">{t("cal_about_license")}</p>
        <pre className="text-default mt-4 whitespace-pre-wrap font-sans text-sm leading-6">
          {UPSTREAM_LICENSE}
        </pre>
      </div>
    </section>
  );
}
