#!/usr/bin/env bash
# Autonomous docs fix loop.
# Usage: scripts/autofix.sh <path-to-audit-report.json> [--deep]
set -euo pipefail

REPORT_PATH="${1:?Usage: autofix.sh <audit-report.json> [--deep]}"
DEEP="${2:-}"
MAX_ATTEMPTS=3
BRANCH="docs/auto-fix-$(date +%Y%m%d-%H%M%S)"
BUILD_PASSED=false
BUILD_ERRORS=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ─── Git config for CI ────────────────────────────────────────────────────────

git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

# ─── Guard: nothing to do? ────────────────────────────────────────────────────

FINDINGS_COUNT=$(node -e "
const r = JSON.parse(require('fs').readFileSync('$REPORT_PATH', 'utf-8'));
process.stdout.write(String(r.summary.totalFindings));
")

if [ "$FINDINGS_COUNT" -eq 0 ]; then
  echo "audit-report has 0 findings — nothing to fix."
  exit 0
fi

# ─── Branch ───────────────────────────────────────────────────────────────────

git checkout -b "$BRANCH"

# ─── Read context ─────────────────────────────────────────────────────────────

REPORT=$(cat "$REPORT_PATH")
CLAUDE_MD=$(cat "$ROOT_DIR/CLAUDE.md" 2>/dev/null || echo "(no CLAUDE.md found)")

build_prompt() {
  local extra_errors="${1:-}"
  cat <<PROMPT
You are fixing issues in a Starlight/Astro documentation site.

## Project Conventions (from CLAUDE.md)
${CLAUDE_MD}

## Audit Findings
\`\`\`json
${REPORT}
\`\`\`

## Your Task
Fix every finding listed in the audit report above. For each finding:
- \`file\` is the relative path from the project root
- \`line\` is the approximate line number
- \`message\` explains what needs to be fixed

After fixing all findings, run: npm run build

${extra_errors:+## Previous Build Errors (fix these too)
${extra_errors}}
PROMPT
}

# ─── Fix loop ─────────────────────────────────────────────────────────────────

for attempt in $(seq 1 $MAX_ATTEMPTS); do
  echo "=== Fix attempt ${attempt}/${MAX_ATTEMPTS} ==="

  PROMPT_FILE=$(mktemp /tmp/autofix-prompt-XXXXX.txt)
  build_prompt "$BUILD_ERRORS" > "$PROMPT_FILE"

  claude -p "$(cat "$PROMPT_FILE")" \
    --allowedTools "Edit,Read,Glob,Grep,Bash(npm run build)"

  rm -f "$PROMPT_FILE"

  if npm run build > /tmp/build-out.txt 2>&1; then
    BUILD_PASSED=true
    echo "Build passed on attempt ${attempt}."
    break
  else
    BUILD_ERRORS="${BUILD_ERRORS}

--- Attempt ${attempt} build errors ---
$(cat /tmp/build-out.txt)"
    echo "Build failed on attempt ${attempt}."
  fi
done

# ─── Commit changes ───────────────────────────────────────────────────────────

git add -A
if git diff --cached --quiet; then
  echo "Claude made no file changes. Exiting without opening PR."
  git checkout -
  git branch -D "$BRANCH"
  exit 0
fi

git commit -m "docs: auto-fix audit findings [$(date +%Y-%m-%d)]"

# ─── Build PR body ────────────────────────────────────────────────────────────

DATE=$(date +%Y-%m-%d)
MODE=$([ -n "$DEEP" ] && echo "Deep (weekly)" || echo "PR audit")
BUILD_STATUS=$([ "$BUILD_PASSED" = true ] && echo "✅ Passing" || echo "❌ Failing (after ${MAX_ATTEMPTS} attempts)")

PR_BODY=$(node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('$REPORT_PATH', 'utf-8'));
const checks = ['broken-links','case-sensitivity','mdx-hazards','sidebar','base-path'];
if (r.deep) checks.push('image-paths','schema-drift');

const rows = checks.map(c => {
  const status = r.summary.failed.includes(c) ? '❌' : '✅';
  const count = r.findings.filter(f => f.check === c).length;
  return \`| \${c} | \${status} | \${count} |\`;
}).join('\n');

const findingsList = r.findings.length === 0
  ? 'None'
  : r.findings.map(f => \`- **[\${f.check}]** \\\`\${f.file}:\${f.line}\\\` — \${f.message}\`).join('\n');

const buildNote = '$BUILD_PASSED' === 'true'
  ? ''
  : '\n> ⚠️ **Build still failing after $MAX_ATTEMPTS fix attempts — human review needed.**';

const body = [
  '## Docs Health Audit — $DATE',
  '',
  '**Mode:** $MODE',
  '**Build:** $BUILD_STATUS',
  '',
  '### Summary',
  '',
  '| Check | Status | Findings |',
  '|---|---|---|',
  rows,
  '',
  '### Findings',
  '',
  findingsList,
  '',
  '### Actions Taken',
  '',
  'Automated fixes applied by \`scripts/autofix.sh\`.',
  buildNote,
  '',
  '---',
  '🤖 Generated by the docs health system',
].join('\n');

process.stdout.write(body);
")

# ─── Open PR ──────────────────────────────────────────────────────────────────

git push origin "$BRANCH"

LABELS="docs-auto-fix"
if [ "$BUILD_PASSED" = false ]; then
  LABELS="docs-auto-fix,build-failing"
fi

gh pr create \
  --title "docs: auto-fix ${DATE}" \
  --body "$PR_BODY" \
  --base main \
  --label "$LABELS"
