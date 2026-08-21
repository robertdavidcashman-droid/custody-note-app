#!/usr/bin/env bash
# Single green/red health check for all workspace deploys.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/workspaces.manifest.json"
FAIL=0

ok() { echo "OK  $*"; }
bad() { echo "FAIL $*"; FAIL=1; }
warn() { echo "WARN $*"; }

echo "=== Workspace clones ==="
while IFS=$'\t' read -r name dir slug branch; do
  [[ -z "$name" ]] && continue
  path="$ROOT/$dir"
  if [[ "$dir" == "." ]]; then
    path="$ROOT"
  fi
  if [[ ! -d "$path/.git" ]]; then
    bad "$name: missing git clone at $dir"
    continue
  fi
  if [[ "$dir" != "." ]]; then
    remote=$(git -C "$path" remote get-url origin 2>/dev/null || echo "")
    # Never print tokens embedded in clone URLs
    remote_safe=$(echo "$remote" | sed -E 's#https://[^@]+@#https://***@#')
    if [[ -z "$remote" ]]; then
      bad "$name: no origin remote"
    else
      ok "$name: clone present ($branch) → $remote_safe"
      case "$remote" in
        *robertcashman-bit*)
          # Transition: local may still fetch bit until droid repo is created (DEPLOY_ONCE §6).
          # Probe GitHub API by HTTP status so network/rate-limit errors are not treated as "missing".
          api_headers=(-H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
          token="${GH_PAT:-${GITHUB_PAT:-${GITHUB_TOKEN:-}}}"
          if [[ -n "$token" ]]; then
            api_headers+=(-H "Authorization: Bearer ${token}")
          fi
          http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
            "${api_headers[@]}" "https://api.github.com/repos/${slug}" 2>/dev/null) || true
          [[ -z "$http_code" ]] && http_code="000"
          case "$http_code" in
            200)
              bad "$name: origin still points at bit — retarget to $slug (droid is sole publisher)"
              ;;
            404)
              warn "$name: origin still on bit; droid repo $slug not created yet — see DEPLOY_ONCE.md"
              ;;
            *)
              bad "$name: origin still on bit; could not verify droid repo $slug (HTTP ${http_code}) — retarget once reachable (see DEPLOY_ONCE.md)"
              ;;
          esac
          ;;
      esac
    fi
    # empty repo?
    if ! git -C "$path" rev-parse HEAD >/dev/null 2>&1; then
      if [[ "$name" == "PSRUKTrain" ]]; then
        warn "$name: clone has no commits (source recovery pending — see DEPLOY_ONCE.md §6)"
      else
        bad "$name: clone has no commits (needs seed)"
      fi
    fi
  else
    ok "$name: root repo ($slug)"
  fi
done < <(python3 - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for r in m["repos"]:
    print(f"{r['name']}\t{r['dir']}\t{r['github']}\t{r['branch']}")
PY
)

echo ""
echo "=== Desktop updater feed (installed apps) ==="
APP_VER=$(node -p "require('$ROOT/custody-note-app-source/package.json').version" 2>/dev/null || echo "")
DROID_YML=$(curl -fsSL "https://github.com/robertdavidcashman-droid/custody-note-app/releases/latest/download/latest.yml" 2>/dev/null | head -1 || true)
DROID_VER=$(echo "$DROID_YML" | sed -n 's/^version: *//p')
PUBLISH_OWNER=$(node -p "require('$ROOT/custody-note-app-source/package.json').build.publish.owner" 2>/dev/null || echo "")

if [[ -z "$APP_VER" ]]; then
  bad "Could not read custody-note-app-source/package.json version"
else
  ok "App source version: $APP_VER"
fi
if [[ "$PUBLISH_OWNER" == "robertdavidcashman-droid" ]]; then
  ok "package.json publish.owner is droid"
else
  bad "package.json publish.owner is '${PUBLISH_OWNER:-missing}' (want robertdavidcashman-droid)"
fi
if [[ "$DROID_VER" == "$APP_VER" ]]; then
  ok "Production updater (droid) is $DROID_VER"
else
  bad "Production updater (droid) is '${DROID_VER:-missing}' but app source is '$APP_VER' — Check for updates will not offer this build"
fi
if [[ -f "$ROOT/.github/workflows/publish-updater-feed.yml" ]]; then
  bad "Bit-mirror workflow still present: .github/workflows/publish-updater-feed.yml — delete it"
else
  ok "No bit-mirror publish-updater-feed workflow"
fi

echo ""
echo "=== Website releases.json ==="
WEB_JSON="$ROOT/custody-note-website/data/releases.json"
if [[ -f "$WEB_JSON" ]]; then
  WEB_VER=$(node -p "require('$WEB_JSON').version" 2>/dev/null || echo "")
  if [[ "$WEB_VER" == "$APP_VER" ]]; then
    ok "Local website releases.json is $WEB_VER"
  else
    bad "Local website releases.json is '${WEB_VER:-missing}' but app is '$APP_VER'"
  fi
else
  bad "custody-note-website/data/releases.json missing — run npm run sync-website in app source"
fi

# Live site tip (best-effort)
LIVE_HINT=$(curl -fsSL "https://custodynote.com/changelog" 2>/dev/null | python3 -c "import sys,re; h=sys.stdin.read(); m=re.findall(r'1\\.\\d+\\.\\d+', h); print(m[0] if m else '')" 2>/dev/null || true)
if [[ -n "$LIVE_HINT" ]]; then
  if [[ "$LIVE_HINT" == "$APP_VER" ]]; then
    ok "Live custodynote.com changelog leads with $LIVE_HINT"
  else
    warn "Live custodynote.com changelog leads with $LIVE_HINT (want $APP_VER) — push website master"
  fi
fi

echo ""
echo "=== Root release workflows ==="
for f in auto-tag-release.yml release-publish.yml; do
  if [[ -f "$ROOT/.github/workflows/$f" ]]; then
    ok "Root workflow present: $f"
  else
    bad "Missing root workflow: .github/workflows/$f"
  fi
done
if grep -q 'robertcashman-bit' "$ROOT/.github/workflows/release-publish.yml" 2>/dev/null; then
  bad "release-publish.yml still references robertcashman-bit"
else
  ok "release-publish.yml has no bit references"
fi
if [[ -f "$ROOT/custody-note-app-source/.github/workflows/README.md" ]]; then
  ok "Nested workflows folder documents stubs (live CI is root-only)"
elif [[ -f "$ROOT/custody-note-app-source/.github/workflows/release-publish.yml" ]]; then
  warn "Nested workflow under custody-note-app-source/.github — ensure it is a stub (see README)"
fi

echo ""
echo "=== Vercel links ==="
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  bash "$ROOT/scripts/verify-vercel-links.sh" || FAIL=1
else
  warn "VERCEL_TOKEN unset — skip live Vercel Git check. Authenticate Vercel MCP or set token, then re-run."
  warn "Manual: see DEPLOY_ONCE.md §4"
fi

echo ""
echo "=== Secrets presence (local env only) ==="
[[ -n "${GH_PAT:-}${GITHUB_PAT:-}" ]] && ok "GH_PAT/GITHUB_PAT present in this environment" || warn "GH_PAT/GITHUB_PAT not in env — optional for website push / seeding"
[[ -n "${VERCEL_TOKEN:-}" ]] && ok "VERCEL_TOKEN present" || warn "VERCEL_TOKEN not in env"

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL CHECKS PASSED"
  exit 0
fi
echo "FAILED — fix items above (usually: publish updater on droid, seed empty clones, push website)"
exit 1
