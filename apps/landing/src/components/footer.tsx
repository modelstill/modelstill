import { DOCS_URL, FOOTER } from "@/lib/content";
import { Wordmark } from "./marks";
import { Reveal } from "./reveal";

export function Footer() {
  return (
    <footer className="mt-[40px]">
      <div className="footer-sky">
        <div className="mx-auto w-full max-w-[1328px] px-6 pt-[46px] min-[1390px]:px-0">
          <Reveal className="flex flex-col gap-12 lg:flex-row lg:justify-between">
            <div className="max-w-[440px]">
              <a href="/" aria-label="ModelStill home">
                <Wordmark />
              </a>
              <p className="mt-[22px] text-[17px] leading-[27px] text-[#5f6672] sm:mt-[26px] sm:text-[19px] sm:leading-[30px]">{FOOTER.blurb}</p>
            </div>
            <nav aria-label="Footer" className="grid grid-cols-2 gap-x-[60px] gap-y-10 sm:grid-cols-3">
              {FOOTER.columns.map((column) => (
                <div key={column.title}>
                  <h2 className="font-serif text-[19px] leading-none tracking-[-0.01em] text-[#1b1b1b]">{column.title}</h2>
                  <ul className="mt-[30px] flex flex-col gap-[20px]">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <a href={link.site ? link.path : `${DOCS_URL}${link.path}`} className="text-[16px] leading-none text-[#5f6672] transition-colors hover:text-[#1b1b1b]">
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </Reveal>
          <div className="mt-[44px] flex flex-col gap-2 border-t border-[#9aa3b0]/60 py-[20px] text-[16px] text-[#4b515b] sm:flex-row sm:items-center sm:justify-between">
            <p>{FOOTER.licence}</p>
            <p>{FOOTER.copyright}</p>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="relative h-[240px] overflow-hidden sm:h-[420px]">
        <div className="wash-dunes absolute -inset-[60px]" style={{ filter: "url(#wash-streak)" }} />
        <div className="absolute inset-x-0 top-0 h-[90px] bg-gradient-to-b from-[#b9c2cf] to-transparent" />
      </div>
    </footer>
  );
}
