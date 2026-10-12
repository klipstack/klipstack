import SwiftUI
import WidgetKit

/// The home screen's "Next up": one article to read, as Home's big card picks it, and in the large
/// size a few more after it, as Home's shelves. No counts and no nudges; a tap opens the article in
/// the reader. The app reloads it on its way to the background
/// and on signing in or out, the share extension after a save (`kind` is the name they use).
@main
struct NextUpWidget: Widget {
  static let kind = "NextUp"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: Provider()) { entry in
      NextUpView(entry: entry)
    }
    .configurationDisplayName("Next Up")
    .description("The article you're reading, or the newest one you saved.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct Entry: TimelineEntry {
  let date: Date
  let nextUp: NextUp
}

struct Provider: TimelineProvider {
  /// About once an hour: the app and the share extension reload it when something changes.
  static let refresh: TimeInterval = 60 * 60
  /// Sooner while a new save is being read from its site: the share extension's reload comes
  /// before it's ready. Five minutes is about the shortest wait iOS keeps to.
  static let processing: TimeInterval = 5 * 60

  func placeholder(in context: Context) -> Entry {
    Entry(date: .now, nextUp: .article(.sample, image: nil, more: Article.moreSamples))
  }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    if context.isPreview {
      completion(placeholder(in: context))
      return
    }
    Task { completion(Entry(date: .now, nextUp: await Klipstack.nextUp().nextUp)) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    Task {
      let (nextUp, processing) = await Klipstack.nextUp()
      let next = Date.now.addingTimeInterval(processing ? Self.processing : Self.refresh)
      completion(Timeline(entries: [Entry(date: .now, nextUp: nextUp)], policy: .after(next)))
    }
  }
}

extension Article {
  /// The widget gallery's example.
  static let sample = Article(
    id: "", title: "The Slow Death of the Hyperlink", url: "https://example.com",
    site: "The Atlantic", readingMinutes: 18, progress: 0.35, status: "ready", savedAt: "",
    leadImage: nil)

  static let moreSamples = [
    Article(
      id: "", title: "What the Printing Press Can Teach Us About Attention",
      url: "https://example.com",
      site: "Aeon", readingMinutes: 14, progress: 0.6, status: "ready", savedAt: "",
      leadImage: nil),
    Article(
      id: "", title: "A Field Guide to Slow Software", url: "https://example.com",
      site: "Increment", readingMinutes: 9, progress: 0, status: "ready", savedAt: "",
      leadImage: nil),
    Article(
      id: "", title: "The Quiet Return of the Personal Website", url: "https://example.com",
      site: "The Verge", readingMinutes: 6, progress: 0, status: "ready", savedAt: "",
      leadImage: nil),
  ]
}

// MARK: - Views

struct NextUpView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .containerBackground(Palette.background, for: .widget)
      .widgetURL(link)
  }

  @ViewBuilder private var content: some View {
    switch entry.nextUp {
    case .article(let article, let image, let more):
      switch family {
      case .systemSmall: SmallArticle(article: article)
      case .systemLarge: LargeArticles(article: article, image: image, more: more)
      default: MediumArticle(article: article, image: image)
      }
    case .nothing:
      Message(
        symbol: "square.and.arrow.up", title: "Your next read starts here",
        detail: family == .systemSmall
          ? "Share an article to Klipstack."
          : "Share an article to Klipstack. It will be here when you're ready.")
    case .signedOut:
      Message(
        symbol: "person.crop.circle", title: "Sign in to Klipstack",
        detail: "Your next read shows here.")
    case .outdated:
      Message(
        symbol: "arrow.down.app", title: "Update Klipstack",
        detail: "This version of the app no longer works.")
    case .unavailable:
      Message(symbol: "book", title: "Open Klipstack", detail: "Your next read shows here.")
    }
  }

  /// The article in the reader (src/app/read/[id].tsx); the app's Home otherwise.
  private var link: URL? {
    if case .article(let article, _, _) = entry.nextUp, let url = reader(article) { return url }
    return URL(string: "klipstack://")
  }
}

/// The article in the reader (src/app/read/[id].tsx); nil for the gallery's examples.
private func reader(_ article: Article) -> URL? {
  article.id.isEmpty ? nil : URL(string: "klipstack://read/\(article.id)")
}

/// The words over Home's big card.
private func label(_ article: Article) -> String {
  article.started ? "Continue reading" : "Up next"
}

/// "12 min left", or "18 min" before reading started.
private func time(_ article: Article) -> String? {
  let minutes = article.started ? article.minutesLeft : article.readingMinutes
  return minutes.map { "\($0) min\(article.started ? " left" : "")" }
}

/// "The Atlantic · 12 min left".
private func meta(_ article: Article) -> String {
  [article.siteName, time(article)].compactMap { $0 }.joined(separator: " · ")
}

struct SmallArticle: View {
  let article: Article

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Eyebrow(text: label(article))
      Text(article.title ?? article.url)
        .font(.custom("Iowan Old Style", size: 17, relativeTo: .headline).weight(.semibold))
        .foregroundStyle(Palette.foreground)
        .lineLimit(3)
        .minimumScaleFactor(0.85)
      Spacer(minLength: 0)
      // Two lines: the time left doesn't fit beside most sites' names.
      VStack(alignment: .leading, spacing: 1) {
        Text(article.siteName).lineLimit(1)
        if let left = time(article) { Text(left).lineLimit(1) }
      }
      .font(.caption)
      .foregroundStyle(Palette.muted)
    }
  }
}

struct MediumArticle: View {
  let article: Article
  let image: Data?

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        Eyebrow(text: label(article))
        Text(article.title ?? article.url)
          .font(.custom("Iowan Old Style", size: 19, relativeTo: .headline).weight(.semibold))
          .foregroundStyle(Palette.foreground)
          .lineLimit(3)
          .minimumScaleFactor(0.85)
        Spacer(minLength: 0)
        Text(meta(article))
          .font(.caption)
          .foregroundStyle(Palette.muted)
          .lineLimit(1)
        if article.started {
          ProgressBar(value: article.progress)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let image, let picture = UIImage(data: image) {
        Image(uiImage: picture)
          .resizable()
          .desaturatedWhenTinted()
          .aspectRatio(contentMode: .fill)
          .frame(width: 96, height: 96)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
    }
  }
}

/// The medium widget's card, then the articles after it, each opening its own.
struct LargeArticles: View {
  let article: Article
  let image: Data?
  let more: [Article]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      MediumArticle(article: article, image: image)
        .frame(height: 112)
      Rectangle()
        .fill(Palette.track)
        .frame(height: 1)
        .padding(.vertical, 14)
      if more.isEmpty {
        Text("Nothing else waiting. Share an article to Klipstack to read it next.")
          .font(.caption)
          .foregroundStyle(Palette.muted)
          .lineLimit(2)
      } else {
        VStack(alignment: .leading, spacing: 12) {
          Eyebrow(text: "Also on your list")
          ForEach(Array(more.enumerated()), id: \.offset) { _, item in
            Row(article: item)
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}

/// One article after the big card: its title and where it's from.
struct Row: View {
  let article: Article

  var body: some View {
    let row = VStack(alignment: .leading, spacing: 2) {
      Text(article.title ?? article.url)
        .font(.custom("Iowan Old Style", size: 15, relativeTo: .subheadline).weight(.semibold))
        .foregroundStyle(Palette.foreground)
        .lineLimit(2)
      Text(meta(article))
        .font(.caption)
        .foregroundStyle(Palette.muted)
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    if let url = reader(article) {
      Link(destination: url) { row }
    } else {
      row
    }
  }
}

struct Eyebrow: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.caption.weight(.semibold))
      .foregroundStyle(Palette.accent)
      .widgetAccentable()
      .lineLimit(1)
  }
}

/// A thin bar, as Home's big card has.
struct ProgressBar: View {
  let value: Double

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(Palette.track)
        Capsule().fill(Palette.accent)
          .frame(width: max(4, geometry.size.width * min(max(value, 0), 1)))
          .widgetAccentable()
      }
    }
    .frame(height: 4)
  }
}

struct Message: View {
  let symbol: String
  let title: String
  let detail: String
  @Environment(\.widgetFamily) private var family

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Image(systemName: symbol)
        .font(.title3)
        .foregroundStyle(Palette.muted)
      Spacer(minLength: 0)
      Text(title)
        .font(.custom("Iowan Old Style", size: 17, relativeTo: .headline).weight(.semibold))
        .foregroundStyle(Palette.foreground)
        .lineLimit(family == .systemSmall ? 3 : 2)
        .minimumScaleFactor(0.85)
      Text(detail)
        .font(.caption)
        .foregroundStyle(Palette.muted)
        .lineLimit(2)
    }
  }
}

extension Image {
  /// In the tinted and clear home screens, the picture in grays rather than the system's tint.
  @ViewBuilder func desaturatedWhenTinted() -> some View {
    if #available(iOS 18.0, *) {
      widgetAccentedRenderingMode(.desaturated)
    } else {
      self
    }
  }
}

/// The app's colors (src/lib/theme.ts), light and dark.
enum Palette {
  static let background = dynamic(light: 0xfbfaf7, dark: 0x111419)
  static let foreground = dynamic(light: 0x1a1d23, dark: 0xe9e8e3)
  static let muted = dynamic(light: 0x5f646b, dark: 0x999fa8)
  static let accent = dynamic(light: 0x243f6c, dark: 0x7faee9)
  static let track = dynamic(light: 0xe0ded8, dark: 0x31363d)

  private static func dynamic(light: UInt32, dark: UInt32) -> Color {
    Color(
      UIColor { traits in
        let hex = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
          red: CGFloat((hex >> 16) & 0xff) / 255,
          green: CGFloat((hex >> 8) & 0xff) / 255,
          blue: CGFloat(hex & 0xff) / 255,
          alpha: 1)
      })
  }
}

#Preview(as: .systemMedium) {
  NextUpWidget()
} timeline: {
  Entry(date: .now, nextUp: .article(.sample, image: nil, more: []))
  Entry(date: .now, nextUp: .nothing)
}

#Preview(as: .systemLarge) {
  NextUpWidget()
} timeline: {
  Entry(date: .now, nextUp: .article(.sample, image: nil, more: Article.moreSamples))
  Entry(date: .now, nextUp: .article(.sample, image: nil, more: []))
  Entry(date: .now, nextUp: .nothing)
}
