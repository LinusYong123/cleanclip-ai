import Navbar from "@/components/Navbar";
import PricingEngine from "@/components/PricingEngine";
import FAQ from "@/components/FAQ";
import Link from "next/link";

export default function Landing() {
  return (
    <main className="min-h-screen bg-bg text-body">
      <Navbar />
      <section className="mx-auto max-w-4xl px-4 pb-16 pt-24 text-center">
        <h1 className="text-4xl font-bold text-white md:text-6xl">Find where every clip really came from</h1>
        <p className="mx-auto mt-5 max-w-xl">Paste a YouTube link or drop a video. CleanClip AI traces the original upload, channel and re-upload timeline, then cuts the key scenes for you.</p>
        <form action="/dashboard" className="mx-auto mt-8 flex max-w-xl gap-2">
          <input name="url" placeholder="Paste YouTube link to trace original source" aria-label="YouTube link"
            className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-white outline-none focus:border-accent" />
          <button className="rounded-xl bg-accent px-5 font-semibold text-bg hover:brightness-110">Trace</button>
        </form>
        <p className="mt-4 text-sm"><Link href="/pricing#elite" className="rounded-full bg-cream/10 px-4 py-2 font-medium text-cream transition hover:bg-cream/20">New: try Elite free for 7 days. Cancel any time.</Link></p>
      </section>
      <PricingEngine />
      <section className="mx-auto max-w-2xl px-4 pb-24">
        <h2 className="mb-6 text-2xl font-semibold text-white">Questions</h2>
        <FAQ />
      </section>
    </main>
  );
}
