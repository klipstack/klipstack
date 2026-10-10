Pod::Spec.new do |s|
  s.name           = 'KlipSpeech'
  s.version        = '1.0.0'
  s.summary        = 'Reads articles aloud on the device, with Kokoro.'
  s.description    = 'Reads articles aloud on the device: Kokoro-82M on ONNX Runtime (CPU), with lock-screen controls.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Klipstack'
  s.homepage       = 'https://klipstack.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/klipstack/klipstack.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Not Core ML: FluidAudio's Core ML Kokoro crashes in Apple's BNNS on iOS 26.4 and later
  # (FluidInference/FluidAudio#844, #889). ONNX Runtime runs it with its own CPU kernels.
  s.dependency 'onnxruntime-objc', '~> 1.30.0'

  s.frameworks = 'AVFoundation', 'MediaPlayer', 'Accelerate'
  s.source_files = '**/*.{h,m,swift}'
  s.resource_bundles = { 'KlipSpeech' => ['Resources/*.json'] }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
