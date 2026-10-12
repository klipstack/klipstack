import Foundation
import ImageIO
import UniformTypeIdentifiers

/// What the widget shows, without the view.
enum NextUp: Sendable {
  /// Home's big card, with its picture, and the articles after it for the large widget.
  case article(Article, image: Data?, more: [Article])
  /// Signed in, with nothing to read.
  case nothing
  case signedOut
  case outdated
  /// The server could not be reached, with nothing kept from before.
  case unavailable
}

/// The few fields of an `ArticleSummary` (packages/api-contract/src/schemas.ts) the widget shows.
struct Article: Codable, Equatable, Sendable {
  var id: String
  var title: String?
  var url: String
  var site: String?
  var readingMinutes: Int?
  /// How far it was read, 0–1.
  var progress: Double
  var status: String
  var savedAt: String
  var leadImage: LeadImage?

  struct LeadImage: Codable, Equatable, Sendable {
    var url: String
    var downloadUrl: String?
  }

  /// The site's name, or its host without one (siteName in src/lib/article-meta.ts).
  var siteName: String {
    site ?? URL(string: url)?.host() ?? url
  }

  /// Minutes left at this progress, rounded up; nil without a reading time (src/lib/home.ts).
  var minutesLeft: Int? {
    guard let readingMinutes, readingMinutes > 0 else { return nil }
    return max(1, Int((Double(readingMinutes) * (1 - progress)).rounded(.up)))
  }

  var started: Bool { progress > 0 }

  /// The API's times have milliseconds: "2026-09-21T20:19:13.149Z".
  var saved: Date? {
    let format = ISO8601DateFormatter()
    format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return format.date(from: savedAt)
  }
}

enum KlipstackError: Error {
  case signedOut
  case outdated
  case unreachable
}

enum Klipstack {
  static let clientId = "klipstack-mobile"

  /// The containing app's version: the extension lives in `Klipstack.app/PlugIns/`.
  static let appVersion: String = {
    let appURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
    let version = Bundle(url: appURL)?.object(forInfoDictionaryKey: "CFBundleShortVersionString")
    return version as? String ?? "0.0.0"
  }()

  private static let http: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.httpShouldSetCookies = false
    config.timeoutIntervalForRequest = 15
    return URLSession(configuration: config)
  }()

  /// One load at a time: the small and medium widgets reload together, and two renewals with the
  /// same refresh token would spend it twice.
  private static let loads = OneAtATime()

  /// Home's big card (homeSections in src/lib/home.ts): the ready article read last, or else the
  /// newest ready unread save. Then, for the large widget, the others in progress and the newest
  /// unread saves, as Home's shelves. Kept for when the server can't be reached. `processing`: a
  /// newer save is still being read from its site, and will be next up once it's ready.
  static func nextUp() async -> Loaded {
    await loads.run(load)
  }

  typealias Loaded = (nextUp: NextUp, processing: Bool)

  @Sendable private static func load() async -> Loaded {
    do {
      // A keychain that can't be read yet (before the first unlock) throws: the kept article shows.
      guard var session = try Keychain.read() else { throw KlipstackError.signedOut }
      var (articles, processing) = try await ready(
        session: &session, filter: "progress", sort: nil, limit: 12)
      if !articles.isEmpty { processing = false }
      // The newest saves only when those in progress don't fill the widget. Only the large widget
      // shows them after an article in progress, so then a failed load of them loses nothing else.
      if articles.count <= maxMore {
        let unread: (articles: [Article], processing: Bool)?
        if articles.isEmpty {
          unread = try await ready(session: &session, filter: "unread", sort: "newest", limit: 20)
        } else {
          unread = try? await ready(session: &session, filter: "unread", sort: "newest", limit: 20)
        }
        if let unread {
          // A save still being read from its site will be next up, or in a large widget's card.
          processing = unread.processing
          let shown = Set(articles.map(\.id))
          articles += unread.articles.filter { !shown.contains($0.id) }
        }
      }
      guard let article = articles.first else {
        Cache.clear()
        return (.nothing, processing)
      }
      let more = Array(articles.dropFirst().prefix(maxMore))
      // The picture kept with the same article, unless its download failed: that one goes again.
      if let kept = Cache.read(), kept.article.leadImage == article.leadImage,
        kept.image != nil || article.leadImage == nil
      {
        Cache.write(article, more: more, image: kept.image)
        return (.article(article, image: kept.image, more: more), processing)
      }
      let image = await picture(article.leadImage, session: session)
      Cache.write(article, more: more, image: image)
      return (.article(article, image: image, more: more), processing)
    } catch KlipstackError.signedOut {
      Cache.clear()
      return (.signedOut, false)
    } catch KlipstackError.outdated {
      return (.outdated, false)
    } catch {
      if let kept = Cache.read() {
        return (.article(kept.article, image: kept.image, more: kept.more), false)
      }
      return (.unavailable, false)
    }
  }

  /// The articles the large widget shows after the big card, side by side.
  static let maxMore = 2

  private struct Page: Decodable {
    var items: [Article]
  }

  /// The list's ready articles. `processing`: a recent save before the first of them is still
  /// being read from its site.
  private static func ready(
    session: inout Session, filter: String, sort: String?, limit: Int
  ) async throws -> ([Article], processing: Bool) {
    var query = [
      URLQueryItem(name: "view", value: "inbox"),
      URLQueryItem(name: "filter", value: filter),
      URLQueryItem(name: "limit", value: String(limit)),
    ]
    if let sort { query.append(URLQueryItem(name: "sort", value: sort)) }
    guard var url = URLComponents(string: "\(session.apiUrl)/api/v1/articles") else {
      throw KlipstackError.unreachable
    }
    url.queryItems = query
    let data = try await get(url.url!, session: &session)
    let page = try JSONDecoder().decode(Page.self, from: data)
    let first = page.items.firstIndex { $0.status == "ready" }
    // Only a recent save, so that one stuck on the server doesn't keep the widget reloading.
    let recently = Date.now.addingTimeInterval(-15 * 60)
    let processing = page.items[..<(first ?? page.items.endIndex)].contains {
      ($0.status == "queued" || $0.status == "processing") && ($0.saved ?? .distantPast) > recently
    }
    return (page.items.filter { $0.status == "ready" }, processing)
  }

  /// An API request, with the session renewed when it has expired or the server refuses it.
  private static func get(_ url: URL, session: inout Session) async throws -> Data {
    if !session.refreshToken.isEmpty, session.expiresAt - 60 <= Date().timeIntervalSince1970 {
      session = try await refresh(session)
    }
    var (status, data) = try await send(authorized(url, session))
    if status == 401, !session.refreshToken.isEmpty {
      session = try await refresh(session)
      (status, data) = try await send(authorized(url, session))
    }
    switch status {
    case 200: return data
    case 401: throw KlipstackError.signedOut
    case 426: throw KlipstackError.outdated
    default: throw KlipstackError.unreachable
    }
  }

  private static func authorized(_ url: URL, _ session: Session) -> URLRequest {
    var request = URLRequest(url: url)
    request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("ios/\(appVersion)", forHTTPHeaderField: "X-Klipstack-Client")
    request.setValue("klipstack-ios/\(appVersion)", forHTTPHeaderField: "User-Agent")
    return request
  }

  /// The article's picture, small: a stored copy through the API with the token, only from the
  /// app's own server, or the site's own image over https (leadImageSource in src/lib/lead-image.ts).
  private static func picture(_ image: Article.LeadImage?, session: Session) async -> Data? {
    guard let image else { return nil }
    var request: URLRequest
    if let download = image.downloadUrl {
      guard let url = URL(string: download), let api = URL(string: session.apiUrl),
        url.scheme == api.scheme, url.host() == api.host(), url.port == api.port
      else { return nil }
      request = authorized(url, session)
      request.setValue("image/*", forHTTPHeaderField: "Accept")
    } else {
      guard image.url.hasPrefix("https://"), let url = URL(string: image.url) else { return nil }
      request = URLRequest(url: url)
    }
    // To a file, not memory, and refused when large: a widget has little memory.
    guard let (file, response) = try? await http.download(for: request) else { return nil }
    defer { try? FileManager.default.removeItem(at: file) }
    let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? .max
    guard (response as? HTTPURLResponse)?.statusCode == 200, size <= maxImageBytes else {
      return nil
    }
    return thumbnail(file, maxPixels: 360)
  }

  private static let maxImageBytes = 10 * 1024 * 1024

  /// A JPEG no wider or taller than `maxPixels`, decoded without the full image in memory.
  private static func thumbnail(_ file: URL, maxPixels: Int) -> Data? {
    guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
      let image = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ] as CFDictionary)
    else { return nil }
    let out = NSMutableData()
    guard
      let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      dest, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    return CGImageDestinationFinalize(dest) ? out as Data : nil
  }

  /// Trades the refresh token for new tokens and stores them for the app too. As the share
  /// extension's (targets/share/ShareViewController.swift): change both together.
  private static func refresh(_ session: Session) async throws -> Session {
    guard let endpoint = URL(string: "\(session.apiUrl)/api/auth/oauth2/token") else {
      throw KlipstackError.unreachable
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
        // The app or the share extension may have renewed the session meanwhile, which spent this
        // refresh token: use what it stores. The widget never deletes the session: the app
        // decides when it is gone, and signs out.
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        if let stored = try? Keychain.read(), stored.refreshToken != session.refreshToken {
          return stored
        }
        throw KlipstackError.signedOut
      }
      throw KlipstackError.unreachable
    }
    guard let access = json["access_token"] as? String,
      let expiresIn = json["expires_in"] as? Double
    else { throw KlipstackError.unreachable }
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
      throw KlipstackError.unreachable
    }
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

/// Must match src/lib/session-store.ts.
struct Session: Codable {
  var apiUrl: String
  var accessToken: String
  var refreshToken: String
  /// Seconds since the epoch.
  var expiresAt: Double
}

/// The app's session item: expo-secure-store's layout for key "session" in service "klipstack".
/// As the share extension's, which also deletes it; the widget only reads and renews it.
enum Keychain {
  private static var query: [String: Any] {
    let key = Data("session".utf8)
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "klipstack:no-auth",
      kSecAttrGeneric as String: key,
      kSecAttrAccount as String: key,
      kSecAttrAccessGroup as String: "group.com.klipstack.app",
    ]
  }

  /// The session; nil when there is none. Throws when the keychain can't be read now (before the
  /// phone's first unlock), which is not signing out.
  static func read() throws -> Session? {
    var q = query
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    q[kSecReturnData as String] = true
    var item: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else {
      throw KlipstackError.unreachable
    }
    return try? JSONDecoder().decode(Session.self, from: data)
  }

  static func write(_ session: Session) {
    guard let data = try? JSONEncoder().encode(session) else { return }
    SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
  }
}

/// The articles last shown and the first one's picture, in the app group's caches, for when the
/// server can't be reached. The app deletes them on signing out (src/lib/widget.ts), and so does
/// the widget when it finds no session.
enum Cache {
  private static var dir: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: "group.com.klipstack.app")?
      .appending(path: "Library/Caches/widget", directoryHint: .isDirectory)
  }

  private struct Kept: Codable {
    var article: Article
    var more: [Article]
  }

  static func read() -> (article: Article, more: [Article], image: Data?)? {
    guard let dir, let data = try? Data(contentsOf: dir.appending(path: "next-up.json")),
      let kept = try? JSONDecoder().decode(Kept.self, from: data)
    else { return nil }
    return (kept.article, kept.more, try? Data(contentsOf: dir.appending(path: "next-up.jpg")))
  }

  static func write(_ article: Article, more: [Article], image: Data?) {
    guard let dir, let data = try? JSONEncoder().encode(Kept(article: article, more: more))
    else { return }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try? data.write(to: dir.appending(path: "next-up.json"), options: .atomic)
    let picture = dir.appending(path: "next-up.jpg")
    if let image {
      try? image.write(to: picture, options: .atomic)
    } else {
      try? FileManager.default.removeItem(at: picture)
    }
  }

  static func clear() {
    guard let dir else { return }
    try? FileManager.default.removeItem(at: dir)
  }
}

/// Runs one piece of work at a time: a caller while it runs gets the same result.
actor OneAtATime {
  private var running: Task<Klipstack.Loaded, Never>?

  func run(_ work: @escaping @Sendable () async -> Klipstack.Loaded) async -> Klipstack.Loaded {
    if let running { return await running.value }
    let task = Task { await work() }
    running = task
    let result = await task.value
    running = nil
    return result
  }
}
