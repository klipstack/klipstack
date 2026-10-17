import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// The clipboard, looked at without reading it. Reading what another app copied shows iOS's
/// "Allow Paste" alert; checking what kind of thing it is doesn't. It is read only through the
/// system's Paste button (`KlipPasteButton`). It also copies rich text with a plain text of our own.
public class KlipPasteboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KlipPasteboard")

    /// Goes up each time anything is copied, on this device or through Universal Clipboard.
    Function("changeCount") { () -> Int in
      UIPasteboard.general.changeCount
    }

    /// Whether the clipboard holds a link: a URL item, which "Copy Link" puts there in any app.
    /// Text isn't checked: iOS's "probably a web link" test takes file names ("notes.md") for links.
    Function("hasLink") { () -> Bool in
      UIPasteboard.general.hasURLs
    }

    /// Copies one item as HTML, for apps that paste rich text (Notes, Mail), and as the plain text
    /// given, for those that don't (Messages): not the text iOS would make from the HTML, which
    /// drops the links' addresses.
    Function("copyRich") { (html: String, plain: String) -> Int in
      UIPasteboard.general.setItems([[
        UTType.html.identifier: html,
        UTType.utf8PlainText.identifier: plain,
      ]])
      return UIPasteboard.general.changeCount
    }

    View(KlipPasteButton.self) {
      Events("onPaste")

      Prop("backgroundColor") { (view, color: UIColor?) in
        view.background = color
      }

      Prop("foregroundColor") { (view, color: UIColor?) in
        view.foreground = color
      }

      OnViewDidUpdateProps { view in
        view.mount()
      }
    }
  }
}
