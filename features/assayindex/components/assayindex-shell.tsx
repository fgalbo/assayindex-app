import Link from "next/link";
import type { ReactNode } from "react";

import { ASSAYINDEX_NAV_ITEMS } from "@/features/assayindex/constants";

type AssayIndexShellProps = {
  title: string;
  description: string;
  eyebrow?: string;
  children: ReactNode;
  actions?: ReactNode;
};

export function AssayIndexShell({
  title,
  description,
  eyebrow = "Public laboratory test data resource",
  children,
  actions,
}: AssayIndexShellProps) {
  return (
    <div className="assayindex-root">
      <a className="assayindex-skip-link assayindex-focus-ring" href="#assayindex-main">
        Skip to AssayIndex content
      </a>
      <div className="assayindex-shell">
        <header className="assayindex-header px-4 py-4 md:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="assayindex-header-copy space-y-3">
                <p className="assayindex-kicker">{eyebrow}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    aria-label="AssayIndex home"
                    className="assayindex-brand assayindex-focus-ring"
                    href="/assayindex"
                  >
                    <span className="assayindex-brand-mark" aria-hidden="true">A/I</span>
                    <span className="assayindex-brand-wordmark">
                      Assay Index
                      <small>laboratory test index</small>
                    </span>
                  </Link>
                  <span className="assayindex-badge assayindex-badge--signal">Searchable + downloadable</span>
                  <Link
                    className="assayindex-back-link assayindex-focus-ring text-sm text-[#b8d1d6] underline-offset-4 hover:text-white hover:underline"
                    href="https://filippogalbo.com/lab"
                  >
                    Back to filippogalbo.com lab
                  </Link>
                </div>
                <h1 className="assayindex-page-title">
                  {title}
                </h1>
                <p className="assayindex-page-description text-sm md:text-base">{description}</p>
              </div>
              {actions ? <div className="assayindex-header-actions assayindex-print-hide">{actions}</div> : null}
            </div>
            <nav aria-label="AssayIndex" className="assayindex-nav assayindex-print-hide text-sm">
              {ASSAYINDEX_NAV_ITEMS.map((item) => (
                <Link key={item.href} className="assayindex-nav-link assayindex-focus-ring" href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="space-y-6" id="assayindex-main">{children}</main>
      </div>
    </div>
  );
}
