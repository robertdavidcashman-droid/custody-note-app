#!/usr/bin/env node
/**
 * Real first-screen redesign for custodynote.com (Clio / LEAP product pattern).
 *
 * Replaces the tidy copy-heavy hero with a product-first fold:
 * - App UI owns ~half+ of the first screen (full-bleed-right framed shot)
 * - Short headline + one promise line (no version badge, no long bullets)
 * - Two CTAs only: Download free + Watch demo
 * - Announcement bar messaging-only; floating download delayed past the fold
 *
 * Uses the existing filled dashboard shot (hero-main-ui). No new photography.
 *
 * Run:
 *   WEBSITE_ROOT=../custody-note-website node scripts/redesign-website-hero.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, '..', 'custody-note-website');

if (!existsSync(WEBSITE_ROOT)) {
  console.error('[redesign-hero] WEBSITE_ROOT not found:', WEBSITE_ROOT);
  process.exit(1);
}

const changed = [];

function write(rel, content) {
  const full = join(WEBSITE_ROOT, rel);
  mkdirSync(dirname(full), { recursive: true });
  const prev = existsSync(full) ? readFileSync(full, 'utf8') : null;
  if (prev === content) return false;
  writeFileSync(full, content, 'utf8');
  changed.push(rel);
  return true;
}

function patch(rel, transform, { required = false } = {}) {
  const full = join(WEBSITE_ROOT, rel);
  if (!existsSync(full)) {
    console.warn('[redesign-hero] missing', rel);
    if (required) process.exit(1);
    return false;
  }
  const prev = readFileSync(full, 'utf8');
  const next = transform(prev);
  if (next == null || next === prev) {
    console.warn('[redesign-hero] no-op patch', rel);
    if (required) process.exit(1);
    return false;
  }
  return write(rel, next);
}

/* ─── 1. Product copy — short first-screen promise ───────────── */
patch(
  'lib/product-copy.ts',
  (src) => {
    let next = src;
    next = next.replace(
      /export const HERO_HEADLINE =\s*"[^"]*";/,
      'export const HERO_HEADLINE =\n  "Structured PACE notes that work offline at the station.";'
    );
    next = next.replace(
      /export const HERO_SUBHEADING =\s*"[^"]*";/,
      'export const HERO_SUBHEADING =\n  "Free during beta. No credit card. Paid Pro planned after beta.";'
    );
    return next;
  },
  { required: true }
);

/* ─── 2. Promo banner — slim messaging only (no Download) ────── */
write(
  'components/GlobalPromoBanner.tsx',
  `import { FREE_FOREVER_TAGLINE } from "@/lib/product-copy";

/**
 * Slim announcement strip — messaging only.
 * Primary download CTAs live in the nav outline button and the hero.
 */
export default function GlobalPromoBanner() {
  return (
    <div className="relative z-[55] w-full border-b border-blue-500/20 bg-brand-950/95 px-3 py-1.5 text-center text-[11px] leading-snug text-blue-100/80 sm:px-4 sm:text-xs">
      <span className="font-medium">
        Structured police station attendance notes — {FREE_FOREVER_TAGLINE.toLowerCase()}
      </span>
    </div>
  );
}
`
);

/* ─── 3. Floating CTA — never on first screen; no lightning ──── */
write(
  'components/FloatingTrialCta.tsx',
  `"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CTA } from "@/lib/cta-analytics";

const HIDE_ON = new Set(["/download", "/app"]);

/**
 * Desktop floating download CTA — hidden on the first screen.
 * Appears only after ~1 viewport scroll so it never sits on the hero product shot.
 * No lightning / emoji treatment.
 */
export default function FloatingTrialCta() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const threshold = () => Math.max(720, Math.round(window.innerHeight * 0.95));
    const onScroll = () => {
      setVisible(window.scrollY > threshold());
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  if (!pathname || HIDE_ON.has(pathname) || !visible) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[58] hidden lg:block">
      <Link
        href="/download"
        data-cta={CTA.START_TRIAL}
        data-event="demo_request"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition-colors hover:bg-blue-500"
      >
        Download Custody Note
      </Link>
    </div>
  );
}
`
);

/* ─── 4. ProductScreenshot — hero + bleed framing ───────────── */
write(
  'components/ProductScreenshot.tsx',
  `import Image from "next/image";

type ProductScreenshotProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Set on the first above-the-fold image only (LCP). */
  priority?: boolean;
  className?: string;
  caption?: string;
  sizes?: string;
  /** Larger hero treatment for the homepage product shot. */
  hero?: boolean;
  /** Soften right/bottom rounding for full-bleed-right compositions. */
  bleed?: boolean;
};

export default function ProductScreenshot({
  src,
  alt,
  width,
  height,
  priority,
  className,
  caption,
  sizes,
  hero,
  bleed,
}: ProductScreenshotProps) {
  const frame = hero
    ? bleed
      ? "relative overflow-hidden rounded-2xl rounded-r-none border border-white/15 border-r-0 bg-brand-950 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.85)] ring-1 ring-white/10"
      : "relative overflow-hidden rounded-2xl border border-white/15 bg-brand-950 shadow-[0_28px_80px_-12px_rgba(0,0,0,0.75)] ring-1 ring-white/10"
    : "relative overflow-hidden rounded-2xl border border-white/10 bg-brand-900/50 shadow-2xl shadow-black/40 ring-1 ring-white/5";

  return (
    <figure className={className}>
      <div className={frame}>
        <div
          className={
            hero
              ? "flex items-center gap-2 border-b border-white/10 bg-brand-900/90 px-4 py-2.5"
              : "flex items-center gap-2 border-b border-white/10 bg-brand-900/70 px-3 py-2"
          }
          aria-hidden
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-2 truncate text-[11px] text-blue-100/45">
            Custody Note
          </span>
        </div>
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={
            sizes ??
            (hero
              ? "(max-width: 1024px) 100vw, 58vw"
              : "(max-width: 768px) 100vw, 640px")
          }
          priority={priority}
          className="h-auto w-full object-cover object-top"
        />
      </div>
      {caption ? (
        <figcaption className="mt-2 text-center text-xs text-blue-100/80">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
`
);

/* ─── 5. Header — one Download free control (no text duplicate) ─ */
patch('components/Header.tsx', (header) => {
  let next = header;
  /* Drop redundant text "Download" link if still present */
  next = next.replace(
    /\s*<Link\s+href="\/download"\s+data-cta=\{CTA\.DOWNLOAD\}[\s\S]*?>\s*Download\s*<\/Link>/,
    ''
  );
  return next;
});

patch('components/HeaderMobileMenu.tsx', (mobile) =>
  mobile.replace(
    /\s*<Link\s+href="\/download"\s+data-cta=\{CTA\.DOWNLOAD\}[\s\S]*?>\s*Download\s*<\/Link>/,
    ''
  )
);

/* ─── 6. Homepage hero — product owns the first screen ───────── */
const NEW_HERO = `        {/* Hero — product-first (Clio / LEAP pattern): app UI owns the fold */}
        <section className="relative overflow-hidden border-b border-white/5">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_35%,rgba(37,99,235,0.22),transparent_55%)]"
            aria-hidden
          />
          <div className="relative mx-auto flex min-h-[calc(100dvh-7.25rem)] max-w-[1440px] flex-col lg:flex-row lg:items-stretch">
            {/* Copy — short headline + one promise + two CTAs */}
            <div className="flex w-full shrink-0 flex-col justify-center px-5 py-10 sm:px-8 lg:w-[40%] lg:max-w-[28rem] lg:py-12 lg:pl-10 lg:pr-4 xl:max-w-[30rem] xl:pl-14">
              <p className="text-sm font-medium tracking-wide text-blue-300/90">
                UK criminal defence · police station work
              </p>
              <h1 className="mt-3 text-[2.15rem] font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[2.55rem] xl:text-[2.75rem]">
                {HERO_HEADLINE}
              </h1>
              <p className="mt-4 max-w-md text-base leading-relaxed text-blue-100/70 sm:text-lg">
                {HERO_SUBHEADING}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/download"
                  data-cta={CTA.START_TRIAL}
                  data-event="demo_request"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-900/30 transition-colors hover:bg-blue-500"
                >
                  {FREE_DOWNLOAD_CTA}
                </Link>
                <Link
                  href="/demo"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/20 px-7 py-3.5 text-base font-medium text-white transition-colors hover:border-white/40 hover:bg-white/5"
                >
                  Watch demo
                </Link>
              </div>
              <p className="mt-5 text-xs leading-relaxed text-blue-200/45">
                Windows 10+ and macOS · Product by Defence Legal Services Ltd
              </p>
            </div>

            {/* Product UI — dominant visual, full-bleed right */}
            <div className="relative min-h-[22rem] min-w-0 flex-1 sm:min-h-[28rem] lg:min-h-0">
              <div className="pointer-events-none absolute -left-8 top-1/2 hidden h-[70%] w-40 -translate-y-1/2 bg-blue-500/20 blur-3xl lg:block" aria-hidden />
              <div className="px-4 pb-10 sm:px-6 lg:absolute lg:inset-y-8 lg:left-0 lg:right-[-6%] lg:px-0 lg:pb-0 xl:inset-y-10 xl:right-[-10%]">
                <ProductScreenshot
                  src="/screenshots/hero-main-ui.webp"
                  alt="Custody Note dashboard showing Custody Attendance, Voluntary Attendance, Telephone Advice, and Quick Capture cards"
                  width={1600}
                  height={950}
                  priority
                  hero
                  bleed
                  sizes="(max-width: 1024px) 100vw, 58vw"
                />
              </div>
            </div>
          </div>
        </section>`;

patch(
  'app/page.tsx',
  (page) => {
    let next = page;

    /* Replace any existing hero section (pre- or post-strengthen) */
    const heroRe =
      /\s*\{\/\* Hero[\s\S]*?<\/section>\s*(?=\{\/\* Problem|{\/\* What|{\/\* Structured|<section)/;
    if (!heroRe.test(next)) {
      console.error('[redesign-hero] could not locate homepage hero section');
      process.exit(1);
    }
    next = next.replace(heroRe, `\n${NEW_HERO}\n\n`);

    /* Drop unused FREE_FOREVER_LABEL import if present and unused after hero cut */
    if (
      next.includes('FREE_FOREVER_LABEL') &&
      !next.match(/FREE_FOREVER_LABEL(?!\s*,)/) &&
      (next.match(/FREE_FOREVER_LABEL/g) || []).length <= 1
    ) {
      next = next.replace(/\s*FREE_FOREVER_LABEL,?/, '');
    }

    /* Ensure CTA import exists (needed for data-cta on hero) */
    if (!next.includes('from "@/lib/cta-analytics"')) {
      next = next.replace(
        'import Link from "next/link";',
        'import Link from "next/link";\nimport { CTA } from "@/lib/cta-analytics";'
      );
    }

    /* Soften "Recent updates (vX)" — keep below fold, not first-screen tone change needed */
    return next;
  },
  { required: true }
);

console.log('[redesign-hero] changed files (' + changed.length + '):');
for (const f of changed) console.log(' -', f);
if (!changed.length) {
  console.log('[redesign-hero] no file changes (already applied?)');
  process.exit(1);
}
process.exit(0);
