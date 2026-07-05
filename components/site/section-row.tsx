import type { ReactNode } from "react";

// Shared catalog-row shell: the rust-tick + Anton-gold section header over a
// horizontal, momentum-scrolling track. Every home rail (continue watching,
// top 3, just released) renders through this so the header treatment and
// edge padding stay identical.
export function SectionRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3.5 tablet:gap-[15px] xl:gap-[18px]">
      <div className="flex items-center gap-2 px-5 tablet:px-8 xl:gap-2.5 xl:px-12">
        <span
          aria-hidden
          className="inline-block h-0.5 w-3.5 rounded-[1px] bg-rust tablet:w-4 xl:w-[18px]"
        />
        <h2 className="font-display text-base uppercase tracking-[0.12em] text-gold tablet:text-lg xl:text-xl">
          {label}
        </h2>
      </div>
      <div className="scrollbar-hidden overflow-x-auto">{children}</div>
    </section>
  );
}
