#!/usr/bin/env bash
# Encrypted nightly database backup. Env: SUPABASE_DB_URL, AGE_PUBLIC_KEY, BACKUP_REPO_TOKEN
# (the token is not needed with BACKUP_DRY_RUN=1, which stops after writing the encrypted file
# into BACKUP_OUT_DIR, default the current directory).
# Plain dumps live only in a temp dir outside any repo and are removed on exit.
set -euo pipefail

: "${SUPABASE_DB_URL:?}" "${AGE_PUBLIC_KEY:?}"
[ "${BACKUP_DRY_RUN:-}" = 1 ] || : "${BACKUP_REPO_TOKEN:?}"
REPO="${BACKUP_REPO:-TerasDigitalSolutions/lapar-backups}"
KEEP=30
NAME="lapar-$(date -u +%F).tar.gz.age"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/dump"

supabase db dump --db-url "$SUPABASE_DB_URL" --role-only -f "$work/dump/roles.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$work/dump/schema.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --use-copy -f "$work/dump/data.sql"
tar czf - -C "$work" dump | age -r "$AGE_PUBLIC_KEY" -o "$work/$NAME"

if [ "${BACKUP_DRY_RUN:-}" = 1 ]; then
  cp "$work/$NAME" "${BACKUP_OUT_DIR:-.}/$NAME"
  echo "dry run: wrote ${BACKUP_OUT_DIR:-.}/$NAME"
  exit 0
fi

# The token goes in a git config header, not the URL, so it is never in the remote URL or logs.
auth=$(printf 'x-access-token:%s' "$BACKUP_REPO_TOKEN" | base64 | tr -d '\n')
echo "::add-mask::$auth"
git_() { git -c "http.extraheader=Authorization: Basic $auth" "$@"; }
git_ clone --depth 1 "https://github.com/$REPO.git" "$work/repo"
cd "$work/repo"
cp "$work/$NAME" .
# File names sort by date, so everything before the newest KEEP is dropped.
ls lapar-*.tar.gz.age | head -n -"$KEEP" | xargs -r git rm -q
git add -A
git -c user.name=lapar-nightly -c user.email=actions@users.noreply.github.com commit -q -m "backup $NAME"
git_ push origin HEAD
echo "backup pushed: $NAME"
