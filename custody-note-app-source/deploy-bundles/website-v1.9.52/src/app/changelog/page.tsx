import type { Metadata } from "next";
import Link from "next/link";
import releasesData from "../../../data/releases.json";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Custody Note release history. See what\u2019s new in every version.",
  robots: { index: true, follow: true },
};

type Release = {
  version: string;
  date: string;
  latest?: boolean;
  changes: string[];
};

const releases = (Array.isArray(releasesData.releases) ? releasesData.releases : []) as Release[];

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <h1 className="text-3xl font-bold text-custody-navy dark:text-white sm:text-4xl">
        Changelog
      </h1>
      <p className="mt-4 text-custody-slate dark:text-custody-light/80">
        What&apos;s new in Custody Note. We release updates regularly to add
        features and fix issues.
      </p>

      <div className="mt-10 space-y-12">
        {releases.slice(0, 40).map((release) => (
          <article
            key={release.version}
            className="rounded-xl border border-custody-slate/15 bg-white p-6 shadow-sm dark:border-custody-light/10 dark:bg-custody-slate/30"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-custody-navy dark:text-white">
                v{release.version}
              </h2>
              {release.latest && (
                <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Latest
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-custody-slate dark:text-custody-light/60">
              {new Date(release.date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
            <ul className="mt-4 space-y-2">
              {release.changes.map((change) => (
                <li
                  key={change}
                  className="flex items-start gap-2 text-sm text-custody-slate dark:text-custody-light/80"
                >
                  <span className="mt-0.5 shrink-0 text-custody-accent">
                    &bull;
                  </span>
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <p className="mt-12 text-sm text-custody-slate dark:text-custody-light/60">
        <Link href="/download" className="text-custody-blue hover:underline dark:text-custody-accent">
          Download the latest version
        </Link>
      </p>
    </div>
  );
}
