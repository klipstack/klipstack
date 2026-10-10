import ExpoModulesCore
import UIKit

/// Shows the system's dictionary sheet, the one behind "Look Up" in Safari's selection menu.
/// The WebView's own menu cannot include it, so the reader asks for it here.
public class KlipLookupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KlipLookup")

    AsyncFunction("define") { (term: String) in
      DispatchQueue.main.async {
        let sheet = UIReferenceLibraryViewController(term: term)
        var top = UIApplication.shared.connectedScenes
          .compactMap { ($0 as? UIWindowScene)?.keyWindow }
          .first?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        top?.present(sheet, animated: true)
      }
    }
  }
}
