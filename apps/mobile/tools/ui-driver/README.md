# UI driver: real taps in the simulator

Taps, swipes, types and takes screenshots in the Klipstack app in the iOS simulator, through
XCUITest. Under Xcode 27 it is the only way an agent can touch the simulator: AXe's input commands
run without error but do nothing.

It is a tiny Xcode project (`project.yml`, for XcodeGen): an empty host app and one UI test,
`UITests/Driver.swift`, that attaches to the installed `com.klipstack.app` and runs a list of
steps. It does not build or launch Klipstack.

## Use

Needs `xcodegen` (`brew install xcodegen`) and a development build already running in a booted
simulator (`pnpm ios`, from `apps/mobile`).

```sh
apps/mobile/tools/ui-driver/run.sh '[
  {"op":"tap","arg":"Library"},
  {"op":"wait","arg":"2"},
  {"op":"shot","arg":"inbox"}
]'
```

The first run generates the Xcode project and builds the driver; later runs skip that until a
source changes. It prints `TEST EXECUTE SUCCEEDED` and one line per step. A step that
finds nothing prints `MISSING <label>` and the run goes on.

| op | arg | does |
| --- | --- | --- |
| `tap` | label | Taps the first element with exactly this accessibility label (waits up to 8 s). |
| `tapxy` | `x,y` | Taps a point, in points from the top left. |
| `hold` | text | Long-presses the first element whose label contains the text. |
| `holdxy` | `x,y` | Long-presses a point. |
| `scrollto` | label | Swipes up until the element is on screen (at most 15 swipes). |
| `swipeup` | | One swipe up. |
| `drag` | `x1,y1,x2,y2` | Drags from one point to another, fast: a scroll or a swipe on a row. |
| `retype` | `label\|text` | Clears the field with this label and types the text. `alert` as the label means the alert's text field. |
| `webtype` | `field\|text` | Like `retype`, in the sign-in sheet's web page (it runs in SafariViewService, outside the app): the field by label or placeholder. End with `\n` to submit. |
| `webtap` | label | Taps a button or link in the sign-in sheet's web page. |
| `wait` | seconds | Waits. |
| `shot` | name | Saves a screenshot to `shots/<name>.png`. |

Screenshots are 3× the point size: divide pixel positions by 3 for `tapxy`. To find a label, take
a screenshot and try the visible text; a row's label is often all its texts joined, so `tapxy` is
safer for rows.

- `KLIPUI_SIM`: the simulator's UDID (default: the first booted one).
- `KLIPUI_SHOTS`: where screenshots go (default: `shots/` here).

`KlipUI.xcodeproj/`, `build/`, `run/` (the steps, the step log, `xcodebuild.log`) and `shots/` are
generated and ignored. After changing `Driver.swift`, the next run rebuilds.
