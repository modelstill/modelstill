import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Panel } from "@/components/panel";
import { Divider, EvaluateSection, SwapSection } from "@/components/sections";
import { WashFilters } from "@/components/wash";

export default function Home() {
  return (
    <>
      <WashFilters />
      <Header />
      <main>
        <Hero />
        <Panel />
        <Divider />
        <EvaluateSection />
        <SwapSection />
      </main>
      <Footer />
    </>
  );
}
