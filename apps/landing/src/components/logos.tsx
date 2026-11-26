export function ToolLogo({ name, logo }: { name: string; logo: string }) {
  return (
    <span className="inline-flex items-center gap-[8px] whitespace-nowrap">
      <img src={logo} alt="" width={24} height={24} loading="lazy" decoding="async" className="size-[24px] rounded-[5px] object-contain" />
      <span className="text-[16px] font-semibold tracking-[-0.02em] text-[#1b1b1b]">{name}</span>
    </span>
  );
}
