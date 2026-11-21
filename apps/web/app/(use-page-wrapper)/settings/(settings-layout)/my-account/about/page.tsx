import { meRouter } from "@calcom/trpc/server/routers/viewer/me/_router";
import { createRouterCaller } from "app/_trpc/context";
import { _generateMetadata } from "app/_utils";
import AboutView from "~/settings/my-account/about-view";
export const generateMetadata = () =>
  _generateMetadata(
    (t) => t("about"),
    (t) => t("cal_about_credits")
  );
export default async function Page() {
  const me = await createRouterCaller(meRouter);
  await me.get({ includePasswordAdded: false });
  return <AboutView />;
}
