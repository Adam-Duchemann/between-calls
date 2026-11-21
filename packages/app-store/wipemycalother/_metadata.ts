import type { AppMeta } from "@calcom/types/App";

export const metadata = {
  name: "WipeMyCal",
  description:
    "Wipe My Cal lets you reschedule multiple meetings at once. Install the app and select Wipe on the date you need to reschedule.",
  installed: true,
  category: "automation",
  categories: ["automation"],
  // If using static next public folder, can then be referenced from the base URL (/).
  logo: "icon-dark.svg",
  publisher: "Cal.diy",
  slug: "wipe-my-cal",
  title: "Wipe my cal",
  type: "wipemycal_other",
  url: "https://cal.com/apps/wipe-my-cal",
  variant: "other",
  email: "help@cal.com",
  dirName: "wipemycalother",
  isOAuth: false,
} as AppMeta;

export default metadata;
