Pod::Spec.new do |s|
  s.name           = 'KlipDictation'
  s.version        = '1.0.0'
  s.summary        = 'Dictating a note, recognized on the device.'
  s.description    = 'Dictating a note, recognized on the device.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Klipstack'
  s.homepage       = 'https://klipstack.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/klipstack/klipstack.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.frameworks = 'AVFoundation', 'Speech'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
