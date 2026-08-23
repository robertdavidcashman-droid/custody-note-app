/**
 * Strengthen custodynote.com product DISPLAY (visual + CTA noise).
 *
 * Priorities:
 * 1. Homepage hero screenshot — larger, window-chrome framed, equal to headline
 *    (keeps existing filled hero-main-ui dashboard shot — no empty state)
 * 2. Hero CTAs — one primary + one secondary only; floating pill delayed past hero
 * 3. Replace empty records-list shots with filled SAMPLE attendances
 * 4. Light framing for InlineScreenshot / ProductScreenshot; no new photography,
 *    testimonials, or security claims; keep free-during-beta copy
 *
 * Run:
 *   WEBSITE_ROOT=../custody-note-website node scripts/strengthen-website-product-display.mjs
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, '..', 'custody-note-website');
const ASSETS = join(APP_ROOT, 'website-product-shots', 'screenshots');

if (!existsSync(WEBSITE_ROOT)) {
  console.error('[strengthen-website] WEBSITE_ROOT not found:', WEBSITE_ROOT);
  process.exit(1);
}
if (!existsSync(ASSETS)) {
  console.error('[strengthen-website] marketing assets missing:', ASSETS);
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
    console.warn('[strengthen-website] missing', rel);
    if (required) process.exit(1);
    return false;
  }
  const prev = readFileSync(full, 'utf8');
  const next = transform(prev);
  if (next == null || next === prev) {
    console.warn('[strengthen-website] no-op patch', rel);
    return false;
  }
  return write(rel, next);
}

function copyAsset(fromRel, toRel) {
  const src = join(ASSETS, fromRel);
  if (!existsSync(src)) {
    console.warn('[strengthen-website] skip missing asset', fromRel);
    return false;
  }
  const dest = join(WEBSITE_ROOT, 'public', 'screenshots', toRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  changed.push('public/screenshots/' + toRel);
  return true;
}

/* ─── 1. Filled SAMPLE records shots ─────────────────────────── */
copyAsset('records-list.webp', 'records-list.webp');
copyAsset('app/records-list.webp', 'app/records-list.webp');
copyAsset('records-list.png', 'records-list.png');
copyAsset('app/records-list.png', 'app/records-list.png');

/* ─── 2. Floating CTA — delayed past the hero viewport ───────── */
write(
  'components/FloatingTrialCta.tsx',
  `"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CTA } from "@/lib/cta-analytics";

const HIDE_ON = new Set(["/download", "/app"]);

/**
 * Desktop floating download CTA — hidden on the hero / first screen.
 * Appears only after the user scrolls roughly one viewport so it never
 * sits on top of the homepage product shot or primary CTAs.
 * Mobile uses StickyDownloadCta instead.
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

/* ─── 3. Header — drop redundant text "Download" link ────────── */
patch('components/Header.tsx', (header) =>
  header.replace(
    /\s*<Link\s+href="\/download"\s+data-cta=\{CTA\.DOWNLOAD\}[\s\S]*?>\s*Download\s*<\/Link>/,
    ''
  )
);
patch('components/HeaderMobileMenu.tsx', (mobile) =>
  mobile.replace(
    /\s*<Link\s+href="\/download"\s+data-cta=\{CTA\.DOWNLOAD\}[\s\S]*?>\s*Download\s*<\/Link>/,
    ''
  )
);

/* ─── 4. Promo banner — messaging only ───────────────────────── */
write(
  'components/GlobalPromoBanner.tsx',
  `import { FREE_FOREVER_TAGLINE } from "@/lib/product-copy";

/**
 * Site-wide announcement strip — messaging only.
 * Primary download CTAs stay in the header and page heroes to avoid CTA shout.
 */
export default function GlobalPromoBanner() {
  return (
    <div className="relative z-[55] w-full border-b border-blue-500/25 bg-gradient-to-r from-blue-950 via-brand-900 to-blue-950 px-3 py-2 text-center text-xs text-blue-100/95 sm:px-4 sm:py-2.5 sm:text-sm">
      <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-2 sm:gap-x-3">
        <span className="font-medium max-w-[36rem] sm:max-w-none">
          Structured police station attendance notes — {FREE_FOREVER_TAGLINE.toLowerCase()}
        </span>
      </span>
    </div>
  );
}
`
);

/* ─── 5. ProductScreenshot — stronger window chrome / shadow ─── */
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
  /** Larger hero treatment — equal visual weight to headline copy. */
  hero?: boolean;
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
}: ProductScreenshotProps) {
  return (
    <figure className={className}>
      <div
        className={
          hero
            ? "relative overflow-hidden rounded-2xl border border-white/15 bg-brand-950 shadow-[0_28px_80px_-12px_rgba(0,0,0,0.75)] ring-1 ring-white/10"
            : "relative overflow-hidden rounded-2xl border border-white/10 bg-brand-900/50 shadow-2xl shadow-black/40 ring-1 ring-white/5"
        }
      >
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
              ? "(max-width: 1024px) 100vw, 720px"
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

/* ─── 6. Homepage hero — larger shot + quiet CTAs ────────────── */
patch(
  'app/page.tsx',
  (page) => {
    let next = page;

    /* Widen hero grid and give the screenshot column equal/larger weight */
    next = next.replace(
      'relative mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-2 lg:items-center lg:gap-10 lg:text-left',
      'relative mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] lg:items-center lg:gap-12 lg:text-left'
    );

    /* Hero CTAs: primary Download free + secondary View Features only.
       Remove Free note generator from the first screen.
       Remove competing Windows/Mac download buttons from the hero —
       platform choice lives on /download (reached by the primary CTA). */
    const noisyCtaBlock = `              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
                <Link
                  href="/download"
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-blue-900/30 transition-colors hover:bg-blue-500"
                >
                  {FREE_DOWNLOAD_CTA}
                </Link>
                <Link
                  href="/features"
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-white/20 px-8 py-4 text-lg font-medium text-white transition-colors hover:border-white/40 hover:bg-white/5"
                >
                  View Features
                </Link>
                <Link
                  href="/free-police-station-attendance-note-generator"
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-8 py-4 text-lg font-medium text-sky-100 transition-colors hover:border-sky-400/50 hover:bg-sky-500/15"
                >
                  Free note generator (UK)
                </Link>
              </div>
              <p className="mt-4 text-xs text-blue-200/50">
                Windows 10+ and macOS (Apple Silicon &amp; Intel) &middot;{" "}
                {FREE_FOREVER_LABEL} on core features &middot; No credit card required
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
                <a
                  href={windowsUrl}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-medium text-white transition-colors hover:border-white/40 hover:bg-white/5"
                >
                  Download for Windows
                </a>
                <MacDownloadPicker
                  version={version}
                  arm64Url={macUrls.arm64}
                  x64Url={macUrls.x64}
                  compact
                />
              </div>`;

    const quietCtaBlock = `              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
                <Link
                  href="/download"
                  data-cta={CTA.START_TRIAL}
                  data-event="demo_request"
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-blue-900/30 transition-colors hover:bg-blue-500"
                >
                  {FREE_DOWNLOAD_CTA}
                </Link>
                <Link
                  href="/features"
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-white/20 px-8 py-4 text-lg font-medium text-white transition-colors hover:border-white/40 hover:bg-white/5"
                >
                  View Features
                </Link>
              </div>
              <p className="mt-4 text-xs text-blue-200/50">
                Windows 10+ and macOS (Apple Silicon &amp; Intel) &middot;{" "}
                {FREE_FOREVER_LABEL} on core features &middot; No credit card required
              </p>`;

    if (next.includes(noisyCtaBlock)) {
      next = next.replace(noisyCtaBlock, quietCtaBlock);
    } else if (
      next.includes('Free note generator (UK)') &&
      next.includes('Download for Windows')
    ) {
      /* Idempotent / already-partially-patched fallback via regex */
      next = next.replace(
        /<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">[\s\S]*?<MacDownloadPicker[\s\S]*?\/>\s*<\/div>/,
        quietCtaBlock.trim()
      );
    }

    /* Hero product shot: drop max-w-lg, pass hero framing, larger sizes */
    const oldShot = `            {/* Product screenshot */}
            <div className="relative mx-auto w-full max-w-lg lg:mx-0">
              <ProductScreenshot
                src="/screenshots/hero-main-ui.webp"
                alt="Custody Note dashboard showing Custody Attendance, Voluntary Attendance, Telephone Advice, and Quick Capture cards"
                width={1600}
                height={950}
                priority
                sizes="(max-width: 1024px) 100vw, 512px"
              />
            </div>`;

    const newShot = `            {/* Product screenshot — visual equal of the headline */}
            <div className="relative mx-auto w-full max-w-2xl lg:max-w-none lg:mx-0">
              <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-blue-500/15 blur-3xl" aria-hidden />
              <ProductScreenshot
                src="/screenshots/hero-main-ui.webp"
                alt="Custody Note dashboard showing Custody Attendance, Voluntary Attendance, Telephone Advice, and Quick Capture cards"
                width={1600}
                height={950}
                priority
                hero
                sizes="(max-width: 1024px) 100vw, 720px"
              />
            </div>`;

    if (next.includes(oldShot)) {
      next = next.replace(oldShot, newShot);
    } else if (next.includes('src="/screenshots/hero-main-ui.webp"')) {
      next = next.replace(
        /\{?\/\* Product screenshot \*\/\}?\s*<div className="relative mx-auto w-full max-w-lg lg:mx-0">[\s\S]*?src="\/screenshots\/hero-main-ui\.webp"[\s\S]*?<\/div>/,
        newShot.trim()
      );
      /* Ensure hero prop present even if wrapper already widened */
      if (!next.includes('hero\n') && !next.includes('hero ')) {
        next = next.replace(
          /(src="\/screenshots\/hero-main-ui\.webp"[\s\S]*?priority\n)/,
          '$1                hero\n'
        );
      }
      next = next.replace(
        'sizes="(max-width: 1024px) 100vw, 512px"',
        'sizes="(max-width: 1024px) 100vw, 720px"'
      );
      next = next.replace(
        'className="relative mx-auto w-full max-w-lg lg:mx-0"',
        'className="relative mx-auto w-full max-w-2xl lg:max-w-none lg:mx-0"'
      );
    }

    /* Inside-the-app captions — filled SAMPLE records */
    next = next.replace(
      'alt="Custody Note records list with search, filters for All, Drafts, Finalised, Archived, and quick actions"',
      'alt="Custody Note records list with SAMPLE demonstration attendances, search, and status filters"'
    );
    next = next.replace(
      'caption="All records at a glance"',
      'caption="Sample records list — demonstration data only"'
    );
    next = next.replace(
      'caption="Sample records list — demonstration data only"',
      'caption="Sample records list — demonstration data only"'
    );

    return next;
  },
  { required: true }
);

/* ─── 7. InlineScreenshot — slightly larger frame on SEO pages ─ */
patch('components/InlineScreenshot.tsx', (src) => {
  let next = src;
  if (!next.includes('hero?:')) {
    /* enlarge default frame */
    next = next.replace(
      'className={`my-8 ${className ?? ""}`.trim()}',
      'className={`my-10 ${className ?? ""}`.trim()}'
    );
    next = next.replace(
      'sizes={sizes ?? "(max-width: 768px) 100vw, 720px"}',
      'sizes={sizes ?? "(max-width: 768px) 100vw, 860px"}'
    );
  }
  return next;
});

/* ─── 8. Screenshot catalog + solicitor page caption ─────────── */
patch('lib/screenshots.ts', (sc) =>
  sc.replace(
    /recordsList:\s*\{[\s\S]*?caption:\s*"[^"]*"/,
    (block) =>
      block.replace(
        /caption:\s*"[^"]*"/,
        'caption: "Sample attendances (demonstration data) — search and filter across records"'
      )
  )
);

patch('app/criminal-defence-solicitor-software/page.tsx', (p) =>
  p
    .replace(
      'caption="All Records — search across every attendance by client, UFN, station, custody number or date."',
      'caption="All Records with SAMPLE demonstration attendances — search by client, UFN, station, custody number or date."'
    )
    .replace(
      'caption="All Records with SAMPLE demonstration attendances — search by client, UFN, station, custody number or date."',
      'caption="All Records with SAMPLE demonstration attendances — search by client, UFN, station, custody number or date."'
    )
);

console.log('[strengthen-website] changed files (' + changed.length + '):');
for (const f of changed) console.log(' -', f);
if (!changed.length) {
  console.log('[strengthen-website] no file changes (already applied?)');
  process.exit(1);
}
process.exit(0);
