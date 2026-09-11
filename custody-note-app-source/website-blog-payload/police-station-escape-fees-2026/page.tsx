import SeoLandingShell from "@/components/SeoLandingShell";
import RelatedBlogPosts from "@/components/RelatedBlogPosts";
import FaqJsonLd, { type FaqQA } from "@/components/FaqJsonLd";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_URL } from "@/lib/site";

const SLUG = "police-station-escape-fees-2026";
const TITLE =
  "Police Station Escape Fees in 2026: The Note That Supports the Claim";
const DESCRIPTION =
  "Police station escape fees in 2026: the attendance note is the evidence. What the £650 threshold means, and what the note must show.";
const CANONICAL = `${SITE_URL}/blog/${SLUG}`;
const FEATURED_IMAGE = `/images/blog/${SLUG}/featured.jpg`;
const OG_IMAGE = `/images/blog/${SLUG}/og.jpg`;

const FAQS: FaqQA[] = [
  {
    question:
      "Is the police station escape threshold still three times the local fixed fee?",
    answer:
      "Not for new Unique File Numbers under the current scheme. SI 2025/1251 set a £650 escape threshold (ex VAT) alongside the £320 fixed fee for Police Station Schemes. Confirm the figures on the current LAA fee scheme on GOV.UK. The older “3× local fixed fee” language belongs to previous tables.",
  },
  {
    question: "Do solicitor grades change police station fixed or escape fees?",
    answer:
      "No. Police station Legal Aid fees are not graded. There is one fixed fee. Where a matter escapes, the prescribed hourly rates are one preparation rate and one travel-and-waiting rate — applied to the recorded work, whoever attended.",
  },
  {
    question: "Does six hours at the station automatically mean an escape fee?",
    answer:
      "No. Escape is about costs, not clock time. A case escapes when recorded work costed at the prescribed hourly rates exceeds the escape threshold. Travel and waiting are rated differently from preparation. A long attendance can still stay on the fixed fee if the costed work does not pass the threshold — and a shorter but intensively recorded attendance can escape if it does.",
  },
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: CANONICAL,
  },
  openGraph: {
    title: `${TITLE} | Custody Note`,
    description: DESCRIPTION,
    url: CANONICAL,
    type: "article",
    publishedTime: "2026-08-20",
    modifiedTime: "2026-08-20",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Legal time-entry workspace — structured records that support police station escape fee claims",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | Custody Note`,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function PoliceStationEscapeFees2026Page() {
  return (
    <SeoLandingShell
      title={TITLE}
      lede="Most police-station attendances stay on the fixed fee. When profit costs at the prescribed hourly rates go past the escape threshold, the Legal Aid Agency assesses the actual work. The attendance note is the evidence. Confirm every figure against the current LAA fee scheme on GOV.UK before you bill."
      datePublished="2026-08-20"
      dateModified="2026-08-20"
      pagePath={`/blog/${SLUG}`}
    >
      <FaqJsonLd id="escape-fees-2026" items={FAQS} />

      <figure className="not-prose my-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
        <Image
          src={FEATURED_IMAGE}
          alt="Desk workspace with a laptop showing a structured legal time-entry form — the kind of contemporaneous record that supports an escape fee claim"
          width={1536}
          height={1024}
          className="h-auto w-full"
          priority
          sizes="(max-width: 768px) 100vw, 768px"
        />
        <figcaption className="px-4 py-3 text-xs text-blue-100/50">
          Structured time blocks are the evidence. Escape is assessed from
          recorded work at prescribed rates — not from a single end-to-end clock
          total.
        </figcaption>
      </figure>

      <h2>What an escape fee is</h2>
      <p>
        One fixed fee covers the police station attendance: travel, waiting,
        advice, and interview. A matter escapes that fixed fee when the recorded
        work — costed at the prescribed hourly rates — exceeds the escape
        threshold. The threshold is a costs figure, not a clock figure. Travel
        and waiting are rated differently from preparation. Police station Legal
        Aid fees are not graded: there is one fixed fee, and on escape one
        preparation hourly rate and one travel-and-waiting hourly rate, whoever
        attended.
      </p>
      <p>
        Your attendance note supports an escape claim. It does not win one on
        its own. Assessors still decide whether the recorded work is reasonable.
        Without a note that breaks the attendance into clear blocks, there is
        often nothing defensible to assess.
      </p>

      <h2>What changed for 2026</h2>
      <p>
        SI 2025/1251 set a £320 fixed fee and a £650 escape threshold (both ex
        VAT) for all Police Station Schemes. Confirm the live figures on the
        current LAA fee scheme published on GOV.UK before you submit. The change
        applies to Unique File Numbers from 22 December 2025. Older guidance
        that talked about “three times the local fixed fee” belongs to previous
        tables — do not use that multiplier for new UFNs under the current
        scheme.
      </p>
      <p>
        The Standard Crime Contract 2025 and SaBC bulk-claim processes still
        expect clean references and a note that can be reconciled to the claim.
        Fee scheme numbers move; the evidence standard does not. If your firm
        still templates claims from the old 3× rule, update the template before
        the next duty weekend.
      </p>

      <h2>What the note must show</h2>
      <p>
        Treat the note as the primary evidence file for the claim. As a minimum
        it should show who attended; the start and end of each work block;
        travel versus waiting versus disclosure versus consultation versus
        interview; what happened in each block; and why that block took the time
        it did. Carry the identifiers that tie the attendance to the claim: UFN,
        DSCC reference where required, station, offence, and outcome.
      </p>
      <ul>
        <li>
          <strong>Who attended</strong> — name and role of the representative or
          solicitor who did the work. Grades do not change the police station
          fee, but identity still matters for the file.
        </li>
        <li>
          <strong>Block times</strong> — start and end for each distinct period,
          not a single “arrived / left” pair with a narrative in between.
        </li>
        <li>
          <strong>Activity type</strong> — separate travel, waiting, disclosure,
          consultation, and interview so the correct hourly rate can be applied
          when costing for escape.
        </li>
        <li>
          <strong>Substance</strong> — what was disclosed, advised, or done in
          interview, at a level that explains the duration without privileged
          oversharing.
        </li>
        <li>
          <strong>Case anchors</strong> — UFN, DSCC, station, offence under
          investigation, and outcome (NFA, charge, bail, RUI, or other).
        </li>
      </ul>

      <h2>Times often missed</h2>
      <p>
        Escape assessments fail as often from omitted blocks as from weak
        narratives. Return travel is routinely left off. Waiting needs a reason
        — “waiting” with no cause invites reduction. Disclosure that arrives in
        pieces should be timed as separate reviews, not folded into a vague
        pre-interview lump. Each interview needs its own start and end.
        Identifiers that look administrative (UFN, DSCC, custody number) are
        what stop the claim bouncing before anyone reads the note.
      </p>
      <p>
        If you only write up the “interesting” middle of the attendance, you
        have written the part that feels important and omitted the part that
        often tips the costed total over the threshold.
      </p>

      <h2>Treat every attendance as a potential escape case</h2>
      <p>
        You rarely know at instruction whether a matter will escape. A second
        interview, late disclosure, or extended waiting can change the
        arithmetic. The practical habit is to record every attendance as if it
        might be assessed: contemporaneous blocks, clear activity labels, and
        identifiers captured before you leave the suite. That discipline costs
        little on a short fixed-fee job and is decisive when the £650 threshold
        is in play.
      </p>
      <p>
        For related guidance on audit-ready structure, see{" "}
        <Link
          href="/blog/why-attendance-notes-fail-laa-audit"
          className="text-blue-400 hover:underline"
        >
          why attendance notes fail an LAA audit
        </Link>{" "}
        and{" "}
        <Link
          href="/blog/laa-billing-attendance-notes-2026"
          className="text-blue-400 hover:underline"
        >
          LAA billing changes for police station work in 2026
        </Link>
        . Confirm rates and thresholds against GOV.UK; this article is workflow
        guidance, not a substitute for the fee scheme.
      </p>

      <h2>Frequently asked questions</h2>

      <h3 className="text-lg font-semibold text-white mt-6 mb-2">
        Is the escape threshold still 3× the local fixed fee for new UFNs?
      </h3>
      <p>
        No. For Unique File Numbers from 22 December 2025 under SI 2025/1251,
        the published escape threshold is £650 (ex VAT) with a £320 fixed fee
        (ex VAT) for Police Station Schemes. Confirm on GOV.UK. The old 3× local
        fixed fee language is from previous tables.
      </p>

      <h3 className="text-lg font-semibold text-white mt-6 mb-2">
        Do solicitor grades change police station fees?
      </h3>
      <p>
        No. Police station Legal Aid fees are not graded. One fixed fee covers
        the attendance. On escape, cost the work at one preparation hourly rate
        and one travel-and-waiting hourly rate, whoever attended.
      </p>

      <h3 className="text-lg font-semibold text-white mt-6 mb-2">
        Does six hours automatically mean an escape?
      </h3>
      <p>
        No. Escape turns on costed work at prescribed rates versus the
        threshold, not on total hours alone. Travel and waiting are rated
        differently from preparation. Record the blocks so the arithmetic can be
        checked.
      </p>

      <h2>Sources</h2>
      <ul>
        <li>
          SI 2025/1251 — Criminal Legal Aid (Remuneration) (Amendment) (No. 2)
          Regulations 2025 (fixed fee and escape threshold figures; confirm live
          text on legislation.gov.uk / GOV.UK)
        </li>
        <li>Standard Crime Contract 2025</li>
        <li>Submit a Bulk Claim (SaBC) — LAA claim submission process</li>
      </ul>

      <div className="mt-8 rounded-2xl border border-blue-400/20 bg-blue-950/30 p-6">
        <p className="text-white font-semibold mb-2">
          Capture escape-ready time blocks at the station
        </p>
        <p className="text-sm text-blue-100/70 mb-4">
          Custody Note is desktop software for Windows and macOS — offline-first
          attendance notes with structured time and billing fields. It is not a
          CMS, not transcription, and not legal advice. Free during beta.
        </p>
        <Link
          href="/download"
          className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
        >
          Download Custody Note
        </Link>
      </div>

      <RelatedBlogPosts
        currentSlug={SLUG}
        preferCategory="Legal Aid"
      />
    </SeoLandingShell>
  );
}
