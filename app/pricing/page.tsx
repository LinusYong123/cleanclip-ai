import Navbar from "@/components/Navbar";
import PricingEngine from "@/components/PricingEngine";

export const metadata = { title: "Pricing | CleanClip AI" };

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-bg text-body">
      <Navbar />
      <header className="mx-auto max-w-3xl px-4 pt-20 text-center">
        <h1 className="text-4xl font-bold text-white md:text-5xl">Pick the plan that fits your workflow</h1>
        <p className="mt-4">Switch to yearly billing and pay 25% less. Cancel any time.</p>
      </header>
      <PricingEngine />
    </main>
  );
}
