import ExpoModulesCore
import Foundation

/// A language's name in another language, as iOS writes it ("French", "francés"): Hermes, the
/// app's JavaScript engine, has no `Intl.DisplayNames`.
public class KlipLanguageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KlipLanguage")

    /// The name of the language `code` (ISO 639) in `locale`'s language; nil when iOS has none.
    Function("languageName") { (code: String, locale: String) -> String? in
      Locale(identifier: locale).localizedString(forLanguageCode: code)
    }
  }
}
