import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  APP_VERSION,
  MAC_ARM64_STATS_DOWNLOAD_URL,
  MAC_X64_STATS_DOWNLOAD_URL,
  WINDOWS_STATS_DOWNLOAD_URL,
} from "@/lib/config";

export const metadata: Metadata = {
  title: "Download Custody Note for Windows and Mac — Free during beta",
  description:
    "Download Custody Note for Windows 10+ and macOS (Apple Silicon and Intel). Structured attendance notes for solicitors and reps. Free during beta, works offline.",
  robots: { index: true, follow: true },
  alternates: { canonical: `${process.env.NEXT_PUBLIC_SITE_URL || "https://custodynote.com"}/download` },
};

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <h1 className="text-3xl font-bold text-custody-navy dark:text-white sm:text-4xl">
        Download Custody Note
      </h1>
      <p className="mt-4 max-w-2xl text-custody-slate dark:text-custody-light/80">
        Get the desktop app and start recording attendances in minutes. Version {APP_VERSION}.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border-2 border-custody-accent bg-white p-8 shadow-sm dark:bg-custody-slate/30">
          <h2 className="text-lg font-semibold text-custody-navy dark:text-white">
            Windows Installer
          </h2>
          <p className="mt-1 text-sm text-custody-slate dark:text-custody-light/60">
            Version {APP_VERSION} &middot; Windows 10+ &middot; ~90 MB
          </p>
          <a
            href={WINDOWS_STATS_DOWNLOAD_URL}
            className="mt-6 block rounded-lg bg-custody-blue px-5 py-3 text-center text-base font-medium text-white hover:bg-custody-accent"
          >
            Download for Windows
          </a>
          <p className="mt-3 text-center text-xs text-custody-slate dark:text-custody-light/50">
            Free during beta · No credit card required
          </p>
        </div>

        <div id="mac" className="rounded-xl border border-custody-slate/20 bg-white p-8 shadow-sm dark:border-custody-light/10 dark:bg-custody-slate/30">
          <h2 className="text-lg font-semibold text-custody-navy dark:text-white">
            Mac Installers
          </h2>
          <p className="mt-1 text-sm text-custody-slate dark:text-custody-light/60">
            Version {APP_VERSION} &middot; macOS 11+ &middot; ~130 MB
          </p>
          <div className="mt-6 space-y-3">
            <a
              href={MAC_ARM64_STATS_DOWNLOAD_URL}
              className="block rounded-lg bg-custody-blue px-5 py-3 text-center text-base font-medium text-white hover:bg-custody-accent"
            >
              Download for Apple Silicon
            </a>
            <a
              href={MAC_X64_STATS_DOWNLOAD_URL}
              className="block rounded-lg border border-custody-slate/30 px-5 py-3 text-center text-base font-medium text-custody-navy hover:bg-custody-light dark:border-custody-light/20 dark:text-white dark:hover:bg-custody-slate"
            >
              Download for Intel Mac
            </a>
          </div>
          <p className="mt-3 text-xs text-custody-slate dark:text-custody-light/50">
            If macOS Gatekeeper blocks the app, right-click Custody Note in Applications and choose Open.
          </p>
        </div>
      </div>

      <div className="mt-12">
        <h2 className="text-xl font-semibold text-custody-navy dark:text-white">
          What you&apos;ll get
        </h2>
        <p className="mt-2 text-sm text-custody-slate dark:text-custody-light/80">
          Custody Note opens to a command centre with Tel Advice, Quick Capture, and New Attendance — everything in one place.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-custody-slate/15 shadow-lg dark:border-custody-light/10">
          <div className="flex items-center gap-2 border-b border-custody-slate/10 bg-custody-light/60 px-4 py-2.5 dark:bg-custody-slate/50">
            <span className="h-3 w-3 rounded-full bg-red-400/70" />
            <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
            <span className="h-3 w-3 rounded-full bg-green-400/70" />
            <span className="ml-2 text-xs text-custody-slate/60 dark:text-custody-light/40">Custody Note</span>
          </div>
          <div className="relative aspect-video w-full bg-custody-navy/50">
            <Image
              src="/screenshots/home.png"
              alt="Custody Note home screen with action cards"
              fill
              priority
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 896px"
            />
          </div>
        </div>
      </div>

      <div className="mt-12">
        <h2 className="text-xl font-semibold text-custody-navy dark:text-white">
          System requirements
        </h2>
        <ul className="mt-4 space-y-2 text-sm text-custody-slate dark:text-custody-light/80">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-custody-accent">&#10003;</span>
            Windows 10 / 11, or macOS 11+ (Apple Silicon and Intel)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-custody-accent">&#10003;</span>
            4 GB RAM minimum (8 GB recommended)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-custody-accent">&#10003;</span>
            200 MB free disk space
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-custody-accent">&#10003;</span>
            Internet required only for licence validation and cloud backup
          </li>
        </ul>
      </div>

      <div className="mt-12 rounded-xl border border-custody-slate/15 bg-custody-light/30 p-6 dark:border-custody-light/10 dark:bg-custody-slate/20">
        <h3 className="font-semibold text-custody-navy dark:text-white">
          Don&apos;t have a licence key?
        </h3>
        <p className="mt-2 text-sm text-custody-slate dark:text-custody-light/80">
          Start a 30-day free trial &mdash; no credit card required. All
          features are unlocked.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/trial"
            className="rounded-lg bg-custody-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-custody-accent"
          >
            Start free trial
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg border border-custody-slate/30 px-5 py-2.5 text-sm font-medium text-custody-navy hover:bg-custody-light dark:border-custody-light/20 dark:text-white dark:hover:bg-custody-slate"
          >
            See pricing
          </Link>
        </div>
      </div>

      <p className="mt-8">
        <Link
          href="/changelog"
          className="text-sm text-custody-slate hover:text-custody-accent dark:text-custody-light/80 dark:hover:text-custody-accent"
        >
          See what&apos;s new in version {APP_VERSION} &rarr;
        </Link>
      </p>
    </div>
  );
}
