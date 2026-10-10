# klip-speech

Reads articles aloud on the iPhone, offline, with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
(Apache-2.0), an open model: free to run and private, and it sounded clearly better than
Apple's premium voices. The web app doesn't read aloud.

## How it works

1. **Text to phonemes** (`ios/Kokoro/KokoroFrontend.swift`), per sentence:
   - English: numbers spelled out (`EnglishTextNormalizer`), then Kokoro's own pronunciation
     dictionary (Misaki, `us_lexicon_cache.json`), word by word (`KokoroAneEnglishPhonemizer`).
     Words it lacks go to `EnglishFallback`: Misaki's -s/-ed/-ing rules, CMU's dictionary (names;
     `CMUDict`, converted with `Arpabet.misaki` as words are looked up), initialisms and digits,
     compounds, and last `EnglishG2P`, g2p_en's small neural model, read from its own checkpoint
     (`NumpyZip`), that guesses from the spelling. On the 257,000 words of the local library, only
     Greek letters were left.
   - Spanish: spelling rules plus `es_lexicon_cache.json` (`SpanishG2P`).
2. **Phonemes to audio** (`ios/Kokoro/KokoroModel.swift`): Kokoro in ONNX format on ONNX Runtime's
   CPU kernels, two threads. Not Core ML: FluidAudio's Core ML Kokoro crashes inside Apple's BNNS on
   iOS 26.4 and later, iOS 27 included (FluidInference/FluidAudio#844, #889), and GPU work isn't
   allowed with the screen locked.
3. **Playback** (`ios/Kokoro/Narrator.swift`): three sentences rendered ahead of what plays,
   AVAudioEngine with a time-pitch unit for the speed, the lock screen's Now Playing and remote
   commands, audio interruptions and unplugged headphones.
4. **Files** (`ios/Kokoro/SpeechFiles.swift`, `Downloader.swift`): the model, dictionaries and voices
   download on first use into Application Support (left out of backups), pinned to one commit of
   each repository. Only Kokoro's `vocab.json` (1 KB) comes with the app, in `ios/Resources`.

The app side: `src/lib/read-aloud.ts` (the reader's hook), `src/components/listen-bar.tsx`,
`src/app/voices.tsx`, and the page's `klipSentences` / `klipSpeaking` in `src/lib/reader-html.ts`.

## Third-party code and data

| What | From | License |
|---|---|---|
| `ios/Phonemes/*.swift`, except `Support.swift` | [FluidAudio](https://github.com/FluidInference/FluidAudio) at `762baf6` (2026-09-25) | Apache-2.0, `ios/Phonemes/LICENSE-FluidAudio` |
| `us_lexicon_cache.json`, `es_lexicon_cache.json` (downloaded) | [FluidInference/kokoro-82m-coreml](https://huggingface.co/FluidInference/kokoro-82m-coreml), from Misaki and ipa-dict | Apache-2.0; ipa-dict MIT |
| `model.onnx`, `voices/*.bin` (downloaded) | [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) | Apache-2.0 |
| `cmudict.dict` (downloaded) | [CMUdict](https://github.com/cmusphinx/cmudict) at `7479086` | BSD-style |
| `checkpoint20.npz` (downloaded) | [g2p_en](https://github.com/Kyubyong/g2p) at `c6439c2` | Apache-2.0 |
| `ios/Resources/vocab.json` | Kokoro's `config.json` (`vocab`) | Apache-2.0 |

Changes to the FluidAudio files: `Support.swift` replaces what they used from the rest of
FluidAudio (logger, errors, constants, number spelling; no NeMo normalizer), and
`KokoroAneEnglishPhonemizer.swift` passes the word as written to its fallback (marked
"Klipstack:"). Nothing else was changed.
