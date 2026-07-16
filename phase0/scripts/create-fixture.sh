#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 /absolute/output/path" >&2
  exit 64
fi

output=$1
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
template_dir=$(CDPATH= cd -- "$script_dir/../fixtures/task-repo" && pwd)

case "$output" in
  /*) ;;
  *)
    echo "output path must be absolute" >&2
    exit 64
    ;;
esac

if [ -e "$output" ]; then
  echo "refusing to overwrite existing path: $output" >&2
  exit 73
fi

mkdir -p "$output"
cp -R "$template_dir/." "$output/"

git -C "$output" init --initial-branch=main --quiet
git -C "$output" config user.name "Boss Man Phase 0"
git -C "$output" config user.email "phase0@invalid.local"
git -C "$output" config commit.gpgsign false
git -C "$output" config core.autocrlf false
git -C "$output" add --all

GIT_AUTHOR_DATE="2026-07-16T12:00:00Z" \
GIT_COMMITTER_DATE="2026-07-16T12:00:00Z" \
git -C "$output" commit --quiet -m "fixture: seed failing slug behavior"

commit=$(git -C "$output" rev-parse HEAD)
printf '%s\n' "fixture_path=$output"
printf '%s\n' "fixture_commit=$commit"
printf '%s\n' "expected_test_status=fail"
