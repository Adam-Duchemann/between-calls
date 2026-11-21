import process from "node:process";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { Logo } from "@calcom/ui/components/logo";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { informationDocuments as documents } from "@lib/calInformation";
import { getTranslate } from "app/_utils";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export const metadata = { robots: { index: false, follow: false } };

export default async function Page() {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    redirect("/auth/login?callbackUrl=%2Fsettings%2Fmy-account%2Fabout%2Freview");
  }
  if (session.user.role !== "ADMIN") notFound();
  const t = await getTranslate();
  const contactEmail = process.env.CAL_PUBLIC_CONTACT_EMAIL;

  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      <header className="space-y-4">
        <a className="text-subtle text-sm underline" href="/settings/my-account/about">
          {t("cal_information_review_back")}
        </a>
        <Logo />
        <h1 className="text-emphasis text-2xl font-semibold">{t("cal_information_review_title")}</h1>
        <p className="bg-muted text-default rounded-lg border p-4 text-sm leading-6">
          {t(
            process.env.CAL_PUBLIC_INFORMATION_ENABLED === "true"
              ? "cal_information_published_notice"
              : "cal_information_review_notice"
          )}
        </p>
        <nav aria-label={t("cal_information_review_navigation")} className="flex flex-wrap gap-x-5 gap-y-2">
          {documents.map((document) => (
            <a key={document.id} href={`#${document.id}`} className="text-emphasis underline">
              {t(document.title)}
            </a>
          ))}
        </nav>
      </header>
      {documents.map((document) => (
        <section
          key={document.id}
          id={document.id}
          className="border-subtle scroll-mt-8 space-y-4 border-t pt-6">
          <h2 className="text-emphasis text-xl font-semibold">{t(document.title)}</h2>
          {document.blocks.map((block) =>
            block.kind === "heading" ? (
              <h3 key={block.key} className="text-emphasis pt-3 font-semibold">
                {t(block.key)}
              </h3>
            ) : (
              <p key={block.key} className="text-default text-sm leading-7">
                {t(block.key)}
              </p>
            )
          )}
        </section>
      ))}
      {contactEmail && (
        <footer className="text-subtle border-subtle border-t pt-6 text-sm">
          {t("cal_information_review_contact")}{" "}
          <a className="underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
        </footer>
      )}
    </article>
  );
}
