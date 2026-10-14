# klip-dictation

Dictating a note on the iPhone: the microphone into Apple's speech recognizer
(`SFSpeechRecognizer`), on the device only (`requiresOnDeviceRecognition`), so what is said never
leaves the phone. A language the device can't recognize offline is refused rather than sent to
Apple's servers; the keyboard's own dictation still works in the note.

The app side: `src/lib/dictation.ts` (the hook, and how heard text joins the note), the mic in
`src/components/notes-sheet.tsx`, and the listen bar's "Speak" at the end of an article read aloud.
iOS asks for the microphone and speech recognition the first time (`NSMicrophoneUsageDescription`,
`NSSpeechRecognitionUsageDescription` in `app.json`).
