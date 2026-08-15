import * as React from "react";

// Обёртка темы Matio для claude.ai/design (cfg.provider в design-sync).
//
// Продукт живёт в тёмной теме через <html class="dark"> + классы шрифтовых
// переменных next/font (app/layout.tsx). В рантайме Design ни html-класса, ни
// next/font нет, поэтому обёртка воспроизводит то же самое сама: класс dark,
// фирменный фон/шрифт/цвет текста и css-переменные трёх гарнитур, чьи
// @font-face едут в styles.css (см. .design-sync/fonts.css).
export function MatioTheme({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="dark bg-background font-sans text-foreground antialiased"
      style={
        {
          "--font-sans": "'Geist', ui-sans-serif, system-ui, sans-serif",
          "--font-geist-mono": "'Geist Mono', ui-monospace, monospace",
          "--font-display": "'Anton', sans-serif",
          minHeight: "100%",
          padding: "1.5rem",
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
