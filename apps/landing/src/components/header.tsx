"use client";

import { ArrowRightIcon, CaretDownIcon, GithubLogoIcon, ListIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useRef, useState } from "react";
import { CTA, GITHUB, NAV } from "@/lib/content";
import { GithubStars } from "./github-stars";
import { Wordmark } from "./marks";

const PRODUCT = NAV.filter((item) => item.menu === "product");
const LINKS = NAV.filter((item) => !item.menu);
const SOLID_AFTER = 60;

export function CtaButton({ className, arrow = false }: { className?: string; arrow?: boolean }) {
  return (
    <a
      href={CTA.href}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-accent px-[13px] text-[14px] leading-none font-medium tracking-[0.01em] text-white transition-colors hover:bg-[#e06f08] ${className ?? ""}`}
    >
      {CTA.label}
      {arrow ? <ArrowRightIcon size={15} weight="bold" aria-hidden="true" /> : null}
    </a>
  );
}

function GithubLink() {
  return (
    <a
      href={GITHUB.href}
      aria-label={GITHUB.label}
      title={GITHUB.label}
      className="flex size-9 items-center justify-center rounded-full border border-line bg-white/60 transition-colors hover:border-black md:hidden"
    >
      <GithubLogoIcon size={18} weight="fill" className="text-black" />
    </a>
  );
}

function ProductMenu() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  return (
    <li className="group relative" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="product-menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14.5px] text-text transition-colors hover:text-accent"
      >
        Product
        <CaretDownIcon size={12} weight="bold" aria-hidden="true" className={`motion-safe:transition-transform motion-safe:duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        id="product-menu"
        className={`absolute top-full left-1/2 w-[520px] -translate-x-1/2 pt-3 motion-safe:transition-[opacity,visibility] motion-safe:duration-200 ${
          open ? "visible opacity-100" : "invisible opacity-0 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
        }`}
      >
        <ul className="grid grid-cols-2 gap-1 rounded-[16px] border border-line bg-white p-3 shadow-[0_24px_48px_-24px_rgb(31_42_20/0.35)]">
          {PRODUCT.map((item) => (
            <li key={item.label}>
              <a href={item.href} onClick={() => setOpen(false)} className="block rounded-[10px] px-3 py-3 transition-colors hover:bg-[#f6f5f1]">
                <span className="block text-[15px] font-medium text-text">{item.label}</span>
                <span className="mt-1 block text-[13px] leading-[18px] text-muted">{item.note}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

function MobileMenu({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)} className="md:hidden">
      <summary
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex size-9 cursor-pointer list-none items-center justify-center rounded-full border border-line bg-white/60 text-text [&::-webkit-details-marker]:hidden"
      >
        {open ? <XIcon size={18} aria-hidden="true" /> : <ListIcon size={18} aria-hidden="true" />}
      </summary>
      <nav
        aria-label="Menu"
        className="absolute inset-x-3 top-full mt-2 max-h-[calc(100dvh-140px)] overflow-y-auto overscroll-contain rounded-[16px] border border-line bg-white p-3 shadow-[0_24px_48px_-24px_rgb(31_42_20/0.35)]"
      >
        <p className="px-3 pt-2 pb-1 text-[12px] font-medium tracking-[0.08em] text-muted uppercase">Product</p>
        <ul>
          {PRODUCT.map((item) => (
            <li key={item.label}>
              <a href={item.href} onClick={() => onToggle(false)} className="block rounded-[10px] px-3 py-2.5 hover:bg-[#f6f5f1]">
                <span className="block text-[16px] font-medium text-text">{item.label}</span>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-muted">{item.note}</span>
              </a>
            </li>
          ))}
        </ul>
        <ul className="mt-2 border-t border-line pt-2">
          {LINKS.map((item) => (
            <li key={item.label}>
              <a href={item.href} onClick={() => onToggle(false)} className="flex items-center justify-between rounded-[10px] px-3 py-3 text-[16px] font-medium text-text hover:bg-[#f6f5f1]">
                {item.label}
                <ArrowRightIcon size={16} aria-hidden="true" />
              </a>
            </li>
          ))}
          <li>
            <a href={GITHUB.href} className="flex items-center justify-between rounded-[10px] px-3 py-3 text-[16px] font-medium text-text hover:bg-[#f6f5f1]">
              GitHub
              <GithubLogoIcon size={16} weight="fill" className="text-black" aria-hidden="true" />
            </a>
          </li>
        </ul>
        <CtaButton arrow className="mt-3 h-11 w-full text-[15px]" />
      </nav>
    </details>
  );
}

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SOLID_AFTER);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const solid = scrolled || open;

  return (
    <div className="sticky top-0 z-50">
      <header
        data-solid={solid}
        className={`relative border-b motion-safe:transition-[background-color,border-color] motion-safe:duration-300 ${
          solid ? "border-line bg-white/85 backdrop-blur-md" : "border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-[68px] w-full max-w-[1280px] items-center justify-between px-4 sm:h-[84px] sm:px-6 min-[1340px]:px-0">
          <a href="/" aria-label="ModelStill home">
            <Wordmark />
          </a>
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-[10px]">
              <ProductMenu />
              {LINKS.map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="rounded-full px-3 py-1.5 text-[14.5px] text-text transition-colors hover:text-accent">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden md:flex">
              <GithubStars />
            </span>
            <GithubLink />
            <CtaButton className="hidden min-[380px]:inline-flex" />
            <MobileMenu open={open} onToggle={setOpen} />
          </div>
        </div>
      </header>
    </div>
  );
}
