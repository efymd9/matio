import { notFound } from "next/navigation";
import { showLanding } from "@/lib/flags";

export default async function Home() {
  if (!(await showLanding())) {
    notFound();
  }
  return (
    <main className="flex flex-1 items-center justify-center">
      <h1 className="text-4xl font-semibold tracking-tight">Hello</h1>
    </main>
  );
}
