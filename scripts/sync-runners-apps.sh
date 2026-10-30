#!/bin/sh
# Copies the shared RUNNERS app list into Monitor.
# The source of truth is one file shared by Split, Prompt and Monitor:
#   ~/git/runners/_docs/작업 가이드/runners-apps.json
# Run this after that file changes, then commit src/runners-apps.json.
# Icons are not copied here; they live in src/assets/runners-apps/ as 64px PNGs named after the json "icon" field.
set -eu
source_file="$HOME/git/runners/_docs/작업 가이드/runners-apps.json"
target_file="$(cd "$(dirname "$0")/.." && pwd)/src/runners-apps.json"
if [ ! -f "$source_file" ]; then
  echo "not found: $source_file" >&2
  exit 1
fi
cp "$source_file" "$target_file"
echo "copied to $target_file"
