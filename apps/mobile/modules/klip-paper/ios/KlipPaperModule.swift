import ExpoModulesCore
import UIKit

/// The page's paper grain (`KlipPaperView`).
public class KlipPaperModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KlipPaper")

    View(KlipPaperView.self) {
      Prop("scheme") { (view, scheme: String?) in
        view.scheme = scheme == "dark" ? "dark" : "light"
      }
    }
  }
}

/// A view on the page's paper: its background color (React Native's) under a faint grain, the
/// web's `--k-grain`, tiled by UIKit as a pattern. The grain is a layer under the view's children,
/// not a view: the screen's scroll view stays the first subview, where iOS looks for it to shrink
/// the large title and to scroll to the top. The tiles are drawn by `scripts/grain.mjs`.
class KlipPaperView: ExpoView {
  private let grain = CALayer()

  var scheme = "light" {
    didSet {
      if scheme != oldValue { paint() }
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Never animated: a new frame or scheme is drawn at once.
    grain.actions = ["bounds": NSNull(), "position": NSNull(), "backgroundColor": NSNull()]
    layer.insertSublayer(grain, at: 0)
    paint()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    grain.frame = layer.bounds
    // React Native's own sublayers (a border, a gradient) may come in front of it: keep it first.
    if layer.sublayers?.first !== grain { layer.insertSublayer(grain, at: 0) }
  }

  private func paint() {
    grain.backgroundColor = KlipPaperView.pattern(scheme)?.cgColor
  }

  private static var patterns: [String: UIColor] = [:]

  private static func pattern(_ scheme: String) -> UIColor? {
    if let made = patterns[scheme] { return made }
    guard
      let url = Bundle(for: KlipPaperView.self).url(forResource: "KlipPaper", withExtension: "bundle"),
      let bundle = Bundle(url: url),
      let tile = UIImage(named: "grain-\(scheme)", in: bundle, compatibleWith: nil)
    else { return nil }
    let made = UIColor(patternImage: tile)
    patterns[scheme] = made
    return made
  }
}
