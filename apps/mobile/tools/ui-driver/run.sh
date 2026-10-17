#!/bin/sh
# Tap, swipe and screenshot the Klipstack app in the simulator with XCUITest. See README.md.
# Usage: run.sh '<json steps>'   e.g. run.sh '[{"op":"tap","arg":"Library"},{"op":"shot","arg":"lib"}]'
set -eu
if [ $# -ne 1 ]; then
	echo "usage: $0 '<json steps>'" >&2
	exit 2
fi
dir=$(cd "$(dirname "$0")" && pwd)
run="$dir/run"
shots="${KLIPUI_SHOTS:-$dir/shots}"
mkdir -p "$run" "$shots"

# The first booted simulator, unless KLIPUI_SIM names one.
sim="${KLIPUI_SIM:-$(xcrun simctl list devices booted | sed -n 's/.*(\([0-9A-F-]\{36\}\)) (Booted).*/\1/p' | head -1)}"
if [ -z "$sim" ]; then
	echo "No booted simulator: start the app with 'pnpm ios' first" >&2
	exit 1
fi

cd "$dir"
# Generate the Xcode project and build the test bundle when missing or older than their sources.
if [ ! -d KlipUI.xcodeproj ] || [ project.yml -nt KlipUI.xcodeproj ]; then
	xcodegen generate --quiet
fi
built="$dir/build/.built"
if [ ! -f "$built" ] || [ -n "$(find Host UITests KlipUI.xcodeproj -newer "$built" -type f | head -1)" ]; then
	echo "Building the driver (once, about a minute)…" >&2
	xcodebuild build-for-testing -project KlipUI.xcodeproj -scheme UITests \
		-destination "generic/platform=iOS Simulator" -derivedDataPath build >"$run/build.log" 2>&1 ||
		{ grep -E "error:" "$run/build.log" | head -5; echo "Build failed: $run/build.log" >&2; exit 1; }
	touch "$built"
fi

printf '%s\n' "$1" >"$run/steps.json"
rm -f "$run/log.txt"
status=0
TEST_RUNNER_KLIPUI_RUN="$run" TEST_RUNNER_KLIPUI_SHOTS="$shots" \
	xcodebuild test-without-building -project KlipUI.xcodeproj -scheme UITests \
	-destination "id=$sim" -derivedDataPath build >"$run/xcodebuild.log" 2>&1 || status=$?
grep -E "TEST( EXECUTE)? (SUCCEEDED|FAILED)|error:" "$run/xcodebuild.log" | head -5 || true
cat "$run/log.txt" 2>/dev/null || echo "No step log: see $run/xcodebuild.log" >&2
exit $status
