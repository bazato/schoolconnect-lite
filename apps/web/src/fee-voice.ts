export type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export function recognitionConstructor(): (new () => Recognition) | undefined {
  const browser = window as SpeechWindow;
  return browser.isSecureContext ? browser.SpeechRecognition ?? browser.webkitSpeechRecognition : undefined;
}
export function voiceError(code: string) {
  return code === 'not-allowed' || code === 'service-not-allowed' ? 'Microphone permission was denied. You can type the question instead.' : code === 'no-speech' ? 'No speech detected. Try again, or type your question.' : code === 'network' ? 'Speech recognition is unavailable over this connection. Please type your question.' : 'Speech recognition stopped. You can type the question instead.';
}
