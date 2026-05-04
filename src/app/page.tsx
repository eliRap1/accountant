import dynamic from "next/dynamic";
import Navbar from "@/components/ui/Navbar";
import StickyCTA from "@/components/ui/StickyCTA";
import Hero from "@/components/sections/Hero";
import Services from "@/components/sections/Services";
import Approach from "@/components/sections/Approach";
import CTA from "@/components/sections/CTA";
import Footer from "@/components/sections/Footer";

const Dashboard = dynamic(() => import("@/components/sections/Dashboard"), {
  loading: () => (
    <div className="mx-auto w-full max-w-7xl px-6 py-32">
      <div className="h-[600px] w-full animate-pulse rounded-3xl border border-white/5 bg-slate-900/40" />
    </div>
  ),
});

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col">
      <Navbar />
      <Hero />
      <Services />
      <Dashboard />
      <Approach />
      <CTA />
      <Footer />
      <StickyCTA />
    </main>
  );
}
