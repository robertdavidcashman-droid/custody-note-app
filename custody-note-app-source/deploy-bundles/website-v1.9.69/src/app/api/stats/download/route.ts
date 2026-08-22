import { NextRequest, NextResponse } from "next/server";
import {
  APP_VERSION,
  GITHUB_RELEASE_OWNER,
  GITHUB_RELEASE_REPO,
} from "@/lib/config";

/**
 * Redirect download CTAs to droid GitHub release assets.
 * Query `v` is accepted for analytics compatibility but ignored when it would
 * point at a missing asset — we always serve the configured APP_VERSION.
 */
export function GET(request: NextRequest) {
  const platform = (request.nextUrl.searchParams.get("platform") || "").toLowerCase();
  const arch = (request.nextUrl.searchParams.get("arch") || "").toLowerCase();
  const version = APP_VERSION;
  const base = `https://github.com/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPO}/releases/download/v${version}`;

  let filename: string | null = null;
  if (platform === "windows") {
    filename = `Custody-Note-Setup-${version}.exe`;
  } else if (platform === "mac") {
    if (arch === "arm64") filename = `Custody-Note-${version}-arm64.dmg`;
    else if (arch === "x64" || arch === "intel") filename = `Custody-Note-${version}-x64.dmg`;
  }

  if (!filename) {
    return NextResponse.json(
      { error: "Use ?platform=windows or ?platform=mac&arch=arm64|x64" },
      { status: 400 }
    );
  }

  return NextResponse.redirect(`${base}/${filename}`, 302);
}
