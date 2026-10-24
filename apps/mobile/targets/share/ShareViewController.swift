import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WidgetKit

/// The share sheet's "Klipstack" entry: saves the shared link to the signed-in account, then closes.
/// It uses the session the app keeps in the keychain (src/lib/session-store.ts), and refreshes it.
final class ShareViewController: UIViewController {
  private let model = SaveModel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    let host = UIHostingController(rootView: SaveView(model: model) { [weak self] in self?.close() })
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    addChild(host)
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    host.didMove(toParent: self)
    Task { await save() }
  }

  private func save() async {
    guard let url = await sharedLink() else {
      model.state = .failed(String(localized: "There is no link to save here."))
      return
    }
    do {
      let saved = try await Klipstack.save(url)
      model.state = saved ? .saved : .alreadySaved
      // With nothing in progress, the new save is next up once ready (targets/widget/).
      if saved { WidgetCenter.shared.reloadTimelines(ofKind: "NextUp") }
      try? await Task.sleep(nanoseconds: 900_000_000)
      close()
    } catch let error as SaveError {
      model.state = error.state
    } catch {
      model.state = .failed(error.localizedDescription)
    }
  }

  /// A shared URL, or the first web link in shared text (some apps share "Title https://…").
  private func sharedLink() async -> URL? {
    let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
        isWeb(url)
      {
        return url
      }
    }
    for provider in providers
    where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
        as? String, let url = firstWebLink(in: text)
      {
        return url
      }
    }
    return nil
  }

  private func close() {
    extensionContext?.completeRequest(returningItems: nil)
  }
}

private func isWeb(_ url: URL) -> Bool {
  url.scheme == "http" || url.scheme == "https"
}

private func firstWebLink(in text: String) -> URL? {
  let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
  let range = NSRange(text.startIndex..., in: text)
  return detector?.matches(in: text, range: range).compactMap(\.url).first(where: isWeb)
}

// MARK: - Saving

enum SaveState: Equatable {
  case saving
  case saved
  /// The link was in the library already (the API answers 200 instead of 202).
  case alreadySaved
  case signedOut
  case outdated
  case failed(String)
}

enum SaveError: Error {
  case signedOut
  case outdated
  case failed(String)

  var state: SaveState {
    switch self {
    case .signedOut: return .signedOut
    case .outdated: return .outdated
    case .failed(let message): return .failed(message)
    }
  }
}

/// Must match src/lib/session-store.ts.
struct Session: Codable {
  var apiUrl: String
  var accessToken: String
  var refreshToken: String
  /// Seconds since the epoch.
  var expiresAt: Double
}

enum Klipstack {
  static let clientId = "klipstack-mobile"

  /// The containing app's version: the extension lives in `Klipstack.app/PlugIns/`.
  static let appVersion: String = {
    let appURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
    let version = Bundle(url: appURL)?.object(forInfoDictionaryKey: "CFBundleShortVersionString")
    return version as? String ?? "0.0.0"
  }()

  /// No cookies: better-auth checks the Origin of POSTs that carry them.
  private static let http: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.httpShouldSetCookies = false
    config.timeoutIntervalForRequest = 20
    return URLSession(configuration: config)
  }()

  /// True when the link is new to the library.
  static func save(_ link: URL) async throws -> Bool {
    guard var session = Keychain.read() else { throw SaveError.signedOut }
    if session.expiresAt - 60 <= Date().timeIntervalSince1970 {
      session = try await refresh(session)
    }
    var (status, body) = try await post(link, session)
    if status == 401 {
      session = try await refresh(session)
      (status, body) = try await post(link, session)
    }
    switch status {
    case 202: return true
    case 200: return false
    case 401: throw SaveError.signedOut
    case 426: throw SaveError.outdated
    case 429:
      throw SaveError.failed(String(localized: "Too many requests. Wait a moment and try again."))
    case 500...599:
      throw SaveError.failed(String(localized: "Klipstack had a problem. Try again in a moment."))
    default: throw SaveError.failed(errorMessage(body) ?? String(localized: "Klipstack could not save this (\(status))."))
    }
  }

  private static func post(_ link: URL, _ session: Session) async throws -> (Int, Data) {
    guard let endpoint = URL(string: "\(session.apiUrl)/api/v1/articles") else {
      throw SaveError.failed(String(localized: "The server address is not valid."))
    }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("ios/\(appVersion)", forHTTPHeaderField: "X-Klipstack-Client")
    request.setValue("klipstack-ios/\(appVersion)", forHTTPHeaderField: "User-Agent")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["url": link.absoluteString])
    return try await send(request)
  }

  /// Trades the refresh token for new tokens and stores them for the app too.
  private static func refresh(_ session: Session) async throws -> Session {
    guard let endpoint = URL(string: "\(session.apiUrl)/api/auth/oauth2/token") else {
      throw SaveError.failed(String(localized: "The server address is not valid."))
    }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = formEncoded([
      "grant_type": "refresh_token",
      "refresh_token": session.refreshToken,
      "client_id": clientId,
      "resource": "\(session.apiUrl)/api",
    ])
    let (status, data) = try await send(request)
    let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    guard status == 200 else {
      if json["error"] as? String == "invalid_grant" {
        // The app may have renewed the session meanwhile, which spent this refresh token: use what
        // it stored rather than signing both out.
        if let stored = Keychain.read(), stored.refreshToken != session.refreshToken {
          return stored
        }
        Keychain.delete()
        throw SaveError.signedOut
      }
      throw SaveError.failed(String(localized: "Klipstack could not refresh your sign-in (\(status))."))
    }
    guard let access = json["access_token"] as? String,
      let expiresIn = json["expires_in"] as? Double
    else { throw SaveError.failed(String(localized: "Klipstack sent an unexpected answer.")) }
    let next = Session(
      apiUrl: session.apiUrl,
      accessToken: access,
      refreshToken: json["refresh_token"] as? String ?? session.refreshToken,
      expiresAt: (Date().timeIntervalSince1970 + expiresIn).rounded(.down)
    )
    Keychain.write(next)
    return next
  }

  private static func send(_ request: URLRequest) async throws -> (Int, Data) {
    do {
      let (data, response) = try await http.data(for: request)
      return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    } catch {
      throw SaveError.failed(String(localized: "Klipstack is not reachable. Check your connection."))
    }
  }

  private static func errorMessage(_ body: Data) -> String? {
    let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    return (json?["error"] as? [String: Any])?["message"] as? String
  }

  private static func formEncoded(_ fields: [String: String]) -> Data {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    let pairs = fields.map { key, value in
      let v = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
      return "\(key)=\(v)"
    }
    return Data(pairs.joined(separator: "&").utf8)
  }
}

/// The app's session item: expo-secure-store's layout for key "session" in service "klipstack".
enum Keychain {
  private static var query: [String: Any] {
    let key = Data("session".utf8)
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "klipstack:no-auth",
      kSecAttrGeneric as String: key,
      kSecAttrAccount as String: key,
      kSecAttrAccessGroup as String: "group.com.klipstack",
    ]
  }

  static func read() -> Session? {
    var q = query
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    q[kSecReturnData as String] = true
    var item: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data
    else { return nil }
    return try? JSONDecoder().decode(Session.self, from: data)
  }

  static func write(_ session: Session) {
    guard let data = try? JSONEncoder().encode(session) else { return }
    SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
  }

  static func delete() {
    SecItemDelete(query as CFDictionary)
  }
}

// MARK: - View

@MainActor
final class SaveModel: ObservableObject {
  @Published var state: SaveState = .saving
}

struct SaveView: View {
  @ObservedObject var model: SaveModel
  let close: () -> Void

  var body: some View {
    ZStack {
      Color.black.opacity(0.25).ignoresSafeArea()
      VStack(spacing: 14) {
        icon.font(.system(size: 40))
        Text(title).font(.headline).multilineTextAlignment(.center)
        if let detail {
          Text(detail).font(.subheadline).foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        if ![.saving, .saved, .alreadySaved].contains(model.state) {
          Button("Done", action: close).buttonStyle(.borderedProminent).padding(.top, 4)
        }
      }
      .padding(28)
      .frame(maxWidth: 320)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
      .animation(.default, value: model.state)
    }
  }

  @ViewBuilder private var icon: some View {
    switch model.state {
    case .saving: ProgressView().controlSize(.large)
    case .saved, .alreadySaved: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
    case .signedOut: Image(systemName: "person.crop.circle.badge.exclamationmark")
    case .outdated: Image(systemName: "arrow.down.app")
    case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
    }
  }

  private var title: String {
    switch model.state {
    case .saving: return String(localized: "Saving to Klipstack…")
    case .saved: return String(localized: "Saved to Klipstack")
    case .alreadySaved: return String(localized: "Already in Klipstack")
    case .signedOut: return String(localized: "Sign in to Klipstack")
    case .outdated: return String(localized: "Update Klipstack")
    case .failed: return String(localized: "Not saved")
    }
  }

  private var detail: String? {
    switch model.state {
    case .signedOut: return String(localized: "Open the Klipstack app and sign in, then share again.")
    case .outdated: return String(localized: "This version of the app no longer works. Install the latest version.")
    case .failed(let message): return message
    default: return nil
    }
  }
}
