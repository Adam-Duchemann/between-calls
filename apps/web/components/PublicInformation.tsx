import { APP_NAME, LOGO_ICON } from "@calcom/lib/constants";
import { informationDocuments } from "@lib/calInformation";
import { getTranslate } from "app/_utils";
import { notFound } from "next/navigation";

const paths: Record<string, string> = { info: "/cal-info", privacy: "/cal-privacy", terms: "/cal-terms" };

export async function PublicInformation({ documentId }: { documentId: "info" | "privacy" | "terms" }) {
  const document = informationDocuments.find((entry) => entry.id === documentId);
  if (!document) notFound();
  const t = await getTranslate();
  const contactEmail = process.env.CAL_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="min-h-screen bg-[#F6F3EC] px-5 py-10 text-[#292923] sm:py-16">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-6">
          <a href="/" className="inline-flex items-center gap-3 text-lg font-semibold text-[#176B68]">
            <img src={LOGO_ICON} alt="" width={40} height={40} />
            {APP_NAME}
          </a>
          <nav
            aria-label={t("cal_information_public_navigation")}
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {informationDocuments.map((entry) => (
              <a
                key={entry.id}
                href={paths[entry.id]}
                aria-current={entry.id === documentId ? "page" : undefined}
                className="text-[#176B68] underline underline-offset-4">
                {t(entry.title)}
              </a>
            ))}
          </nav>
          <h1 className="font-serif text-3xl font-semibold">{t(document.title)}</h1>
        </header>
        <div className="space-y-5 leading-7">
          {document.blocks.map((block) =>
            block.kind === "heading" ? (
              <h2 key={block.key} className="pt-4 text-lg font-semibold">
                {t(block.key)}
              </h2>
            ) : (
              <p key={block.key}>{t(block.key)}</p>
            )
          )}
        </div>
        {contactEmail && (
          <footer className="border-t border-[#176B68]/20 pt-6 text-sm">
            {t("cal_information_review_contact")}{" "}
            <a className="text-[#176B68] underline" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
          </footer>
        )}
      </article>
    </main>
  );
}
