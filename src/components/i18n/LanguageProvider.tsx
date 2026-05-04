"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translations, type Dict, type Locale, locales } from "./translations";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Dict;
};

const LanguageContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "accountech.locale";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Hydrate from <html lang> set by inline script (avoids FOUC)
  useEffect(() => {
    const initial = (document.documentElement.getAttribute("lang") || "en") as Locale;
    if (locales.includes(initial)) setLocaleState(initial);
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    const meta = translations[l].meta;
    document.documentElement.setAttribute("lang", meta.lang);
    document.documentElement.setAttribute("dir", meta.dir);
    document.documentElement.setAttribute("data-locale", meta.lang);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }

  const t = translations[locale];

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useT(): Dict {
  const ctx = useContext(LanguageContext);
  return ctx ? ctx.t : translations.en;
}

export function useLocale() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLocale must be used inside LanguageProvider");
  return ctx;
}

export const LOCALE_STORAGE_KEY = STORAGE_KEY;
