import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// The system's Paste button (`UIPasteControl`): the tap is the user's consent, so the app reads
/// the clipboard without iOS's "Allow Paste" alert. It always answers with `onPaste`: the link or
/// text pasted, or `text: null` when there was nothing it could read, so a tap is never silent.
class KlipPasteButton: ExpoView {
  let onPaste = EventDispatcher()
  var background: UIColor?
  var foreground: UIColor?
  private var control: UIView?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Any text, whatever its encoding, and URLs.
    pasteConfiguration = UIPasteConfiguration(acceptableTypeIdentifiers: [
      UTType.url.identifier,
      UTType.text.identifier,
    ])
  }

  func mount() {
    control?.removeFromSuperview()
    let configuration = UIPasteControl.Configuration()
    configuration.baseBackgroundColor = background
    configuration.baseForegroundColor = foreground
    configuration.cornerStyle = .capsule
    configuration.displayMode = .iconAndLabel
    let control = UIPasteControl(configuration: configuration)
    control.translatesAutoresizingMaskIntoConstraints = false
    control.target = self
    addSubview(control)
    NSLayoutConstraint.activate([
      control.topAnchor.constraint(equalTo: topAnchor),
      control.bottomAnchor.constraint(equalTo: bottomAnchor),
      control.leadingAnchor.constraint(equalTo: leadingAnchor),
      control.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
    self.control = control
  }

  // Before the tap, iOS may hide what the items are (no providers); the button stays enabled.
  override func canPaste(_ itemProviders: [NSItemProvider]) -> Bool {
    itemProviders.isEmpty || itemProviders.contains {
      $0.canLoadObject(ofClass: URL.self) || $0.canLoadObject(ofClass: String.self)
    }
  }

  override func paste(itemProviders: [NSItemProvider]) {
    guard let provider = itemProviders.first else {
      // No providers: the tap still lets the app read the clipboard itself.
      let board = UIPasteboard.general
      return send(board.url?.absoluteString ?? board.string)
    }
    guard provider.canLoadObject(ofClass: URL.self) else { return loadText(provider) }
    _ = provider.loadObject(ofClass: URL.self) { url, _ in
      if let url { self.send(url.absoluteString) } else { self.loadText(provider) }
    }
  }

  private func loadText(_ provider: NSItemProvider) {
    guard provider.canLoadObject(ofClass: String.self) else { return send(nil) }
    _ = provider.loadObject(ofClass: String.self) { text, _ in
      self.send(text)
    }
  }

  private func send(_ text: String?) {
    DispatchQueue.main.async {
      self.onPaste(["text": text as Any])
    }
  }
}
