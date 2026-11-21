import process from "node:process";
import { PublicInformation } from "@components/PublicInformation";
import { notFound } from "next/navigation";

export default async function Page() {
  if (process.env.CAL_PUBLIC_INFORMATION_ENABLED !== "true") notFound();
  return PublicInformation({ documentId: "info" });
}
