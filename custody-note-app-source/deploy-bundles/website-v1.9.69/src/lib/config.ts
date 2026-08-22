export const SUPPORT_EMAIL = "support@custodynote.com";

/** Keep in sync with data/releases.json (updated by app sync-website). */
export const APP_VERSION = "1.9.69";

export const DOWNLOAD_URL = "/download";

/** Sole publisher for desktop installers. */
export const GITHUB_RELEASE_OWNER = "robertdavidcashman-droid";
export const GITHUB_RELEASE_REPO = "custody-note-app";

const releaseBase = `https://github.com/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPO}/releases/download/v${APP_VERSION}`;

/** Direct GitHub asset URLs (always point at existing droid release assets). */
export const WINDOWS_DOWNLOAD_URL = `${releaseBase}/Custody-Note-Setup-${APP_VERSION}.exe`;
export const MAC_ARM64_DOWNLOAD_URL = `${releaseBase}/Custody-Note-${APP_VERSION}-arm64.dmg`;
export const MAC_X64_DOWNLOAD_URL = `${releaseBase}/Custody-Note-${APP_VERSION}-x64.dmg`;

/** Tracked download endpoints (redirect to the GitHub assets above). */
export const WINDOWS_STATS_DOWNLOAD_URL = `/api/stats/download?platform=windows&v=${APP_VERSION}`;
export const MAC_ARM64_STATS_DOWNLOAD_URL = `/api/stats/download?platform=mac&arch=arm64&v=${APP_VERSION}`;
export const MAC_X64_STATS_DOWNLOAD_URL = `/api/stats/download?platform=mac&arch=x64&v=${APP_VERSION}`;
