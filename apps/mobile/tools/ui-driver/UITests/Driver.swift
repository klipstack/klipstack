import XCTest

/// Runs the steps in $KLIPUI_RUN/steps.json against the installed Klipstack app, writes what it did
/// to $KLIPUI_RUN/log.txt and screenshots to $KLIPUI_SHOTS. run.sh sets both (TEST_RUNNER_ prefix).
final class Driver: XCTestCase {
	func testSteps() throws {
		let env = ProcessInfo.processInfo.environment
		guard let run = env["KLIPUI_RUN"], let shots = env["KLIPUI_SHOTS"] else {
			XCTFail("Run through run.sh: KLIPUI_RUN and KLIPUI_SHOTS are not set")
			return
		}
		let data = try Data(contentsOf: URL(fileURLWithPath: "\(run)/steps.json"))
		let steps = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
		let app = XCUIApplication(bundleIdentifier: "com.klipstack.app")
		app.activate()
		// Where `webtype` and `webtap` act: the sign-in sheet, or Safari after `webapp safari`.
		var web = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
		var log = ""
		for step in steps {
			let op = step["op"] as! String
			let arg = step["arg"] as? String ?? ""
			switch op {
			case "tap":
				let el = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", arg)).firstMatch
				if el.waitForExistence(timeout: 8) { el.tap(); log += "tapped \(arg)\n" } else { log += "MISSING \(arg)\n" }
			case "tapxy":
				let p = arg.split(separator: ",").map { Double($0)! }
				app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: p[0], dy: p[1])).tap()
				log += "tapxy \(arg)\n"
			case "scrollto":
				let el = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", arg)).firstMatch
				var n = 0
				while (!el.exists || !el.isHittable) && n < 15 { app.swipeUp(velocity: .slow); n += 1 }
				log += "scrollto \(arg) \(el.exists && el.isHittable)\n"
			case "swipeup":
				app.swipeUp()
				log += "swipeup\n"
			case "drag":
				// "x1,y1,x2,y2" in points
				let p = arg.split(separator: ",").map { Double($0)! }
				let o = app.coordinate(withNormalizedOffset: .zero)
				o.withOffset(CGVector(dx: p[0], dy: p[1])).press(forDuration: 0.05, thenDragTo: o.withOffset(CGVector(dx: p[2], dy: p[3])), withVelocity: .fast, thenHoldForDuration: 0)
				log += "drag \(arg)\n"
			case "holdxy":
				let p = arg.split(separator: ",").map { Double($0)! }
				app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: p[0], dy: p[1])).press(forDuration: 1.2)
				log += "holdxy \(arg)\n"
			case "hold":
				let el = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", arg)).firstMatch
				if el.waitForExistence(timeout: 8) { el.press(forDuration: 1.2); log += "held \(arg)\n" } else { log += "MISSING \(arg)\n" }
			case "retype":
				// "label|text": the field with that label (or the alert's field, label "alert"), its text replaced
				let parts = arg.split(separator: "|", maxSplits: 1).map(String.init)
				let field = parts[0] == "alert" ? app.alerts.textFields.firstMatch : app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", parts[0])).firstMatch
				if field.waitForExistence(timeout: 8) {
					field.tap()
					field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 60) + parts[1])
					log += "retyped \(parts[0])\n"
				} else { log += "MISSING \(parts[0])\n" }
			case "type":
				// Types into the field that has the keyboard (focus it with `tapxy`): for fields whose
				// label XCUITest does not see, such as a multiline React Native TextInput.
				app.typeText(arg)
				log += "typed\n"
			case "webtype":
				// "field|text": the sign-in sheet's web page (ASWebAuthenticationSession runs in
				// SafariViewService, outside the app): the text field whose label or placeholder is
				// `field`, its text replaced. "\n" at the end submits.
				let parts = arg.split(separator: "|", maxSplits: 1).map(String.init)
				let match = NSPredicate(format: "label == %@ OR placeholderValue == %@", parts[0], parts[0])
				let field = web.descendants(matching: .any).matching(match).matching(NSPredicate(format: "elementType == %d OR elementType == %d", XCUIElement.ElementType.textField.rawValue, XCUIElement.ElementType.secureTextField.rawValue)).firstMatch
				if field.waitForExistence(timeout: 8) {
					field.tap()
					field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 60) + parts[1])
					log += "webtyped \(parts[0])\n"
				} else { log += "MISSING \(parts[0])\n" }
			case "webtap":
				// A button or link with this label on the sign-in sheet's web page.
				let el = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", arg)).firstMatch
				if el.waitForExistence(timeout: 8) { el.tap(); log += "webtapped \(arg)\n" } else { log += "MISSING \(arg)\n" }
			case "webapp":
				// "safari" (brought to the front) or "sheet": where the next `webtype` and `webtap` act.
				web = XCUIApplication(bundleIdentifier: arg == "safari" ? "com.apple.mobilesafari" : "com.apple.SafariViewService")
				if arg == "safari" { web.activate() }
				log += "webapp \(arg)\n"
			case "wait": Thread.sleep(forTimeInterval: Double(arg) ?? 1)
			case "shot":
				let png = XCUIScreen.main.screenshot().pngRepresentation
				try png.write(to: URL(fileURLWithPath: "\(shots)/\(arg).png"))
				log += "shot \(arg)\n"
			default: log += "unknown \(op)\n"
			}
		}
		try log.write(toFile: "\(run)/log.txt", atomically: true, encoding: .utf8)
	}
}
