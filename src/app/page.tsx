import { redirect } from "next/navigation";
import { auth } from "@/auth";
import MarketingHome from "@/components/marketing/MarketingHome";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/dashboard");
  }
  return <MarketingHome />;
}
