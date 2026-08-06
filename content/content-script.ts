interface SharedAPI {
  escapeHtml: (value: unknown) => string;
  sendMessage: (message: object, timeoutMs?: number) => Promise<{ success?: boolean; error?: string; [key: string]: unknown }>;
  createLogger: (namespace: string) => { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

interface FireworksAPI {
  launchFireworks: (effectMode: string, x: number, y: number) => void;
  clearFireworks: () => void;
}

function getFireworksAPI(): FireworksAPI {
  return (window as unknown as { __WordPickerFireworks: FireworksAPI }).__WordPickerFireworks;
}

(function () {
  if ((window as unknown as { __WordPickerContentLoaded?: boolean }).__WordPickerContentLoaded) {
    return;
  }
  (window as unknown as { __WordPickerContentLoaded?: boolean }).__WordPickerContentLoaded = true;

  const { escapeHtml, sendMessage, createLogger } = (window as unknown as { __WordPickerShared: SharedAPI }).__WordPickerShared;
  const _logger = createLogger("content-script");

  const STATE = {
    IDLE: "idle",
    PEN: "pen",
    LOADING: "loading",
    SHOWING: "showing",
    OCR_LOADING: "ocr_loading",
    IMAGE_OVERLAY: "image_overlay",
  } as const;

  type State = typeof STATE[keyof typeof STATE];

  type LookupKey = "Control" | "Meta" | "Alt" | "Shift";
  type FireworksEffect = "canvas" | "css" | "confetti" | "sparkle" | "ripple" | "emoji" | "hearts" | "none";

  function detectPlatform(): "mac" | "win" {
    if (typeof navigator !== "undefined" && navigator.platform) {
      return /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? "mac" : "win";
    }
    return "win";
  }

  function isSafari(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return /Safari\//.test(ua) && !/Chrome|CriOS|Edg\//.test(ua);
  }

  interface PerPlatformLookupKeys {
    mac: LookupKey;
    win: LookupKey;
  }

  const DEFAULT_LOOKUP_KEY: LookupKey = "Control";

  // 图片识别（OCR）功能总开关。当前为临时隐藏状态：基础实现已完成，
  // 但因真实网页实测（跨域/动态图片/识别精度）尚未充分验证，先关闭用户入口。
  // 设为 true 即可恢复悬停图片取词，后端 IMAGE_OCR 处理器与 offscreen 代码保持可用。
  const IMAGE_OCR_ENABLED = false;

  const LANGUAGE_WORD_PATTERNS: Record<string, string> = {
    en: "[A-Za-z][A-Za-z'-]{1,44}",
    fr: "[A-Za-z\u00C0-\u00FF][A-Za-z\u00C0-\u00FF'-]{1,44}",
    es: "[A-Za-z\u00C0-\u00FF\u00D1\u00F1][A-Za-z\u00C0-\u00FF\u00D1\u00F1'-]{1,44}",
    de: "[A-Za-z\u00C0-\u00F6\u00F8-\u00FF][A-Za-z\u00C0-\u00F6\u00F8-\u00FF'-]{1,44}",
    ko: "[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]+",
    ja: "[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]",
  };

  const FRENCH_FEATURE_CHARS = /[\u00E0\u00E2\u00E7\u00E8\u00E9\u00EA\u00EB\u00EE\u00EF\u00F4\u00F9\u00FB\u00FC\u0153]/;
  const SPANISH_FEATURE_CHARS = /[\u00F1\u00A1\u00BF]/;
  const GERMAN_FEATURE_CHARS = /[\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF\u1E9E]/;

  function normalizeLookupKeys(raw: Record<string, unknown>): PerPlatformLookupKeys {
    if (raw.lookupKey !== undefined && !raw.lookupKeys) {
      const oldKey = raw.lookupKey as LookupKey;
      raw.lookupKeys = { mac: oldKey, win: oldKey };
      delete raw.lookupKey;
    }
    if (!raw.lookupKeys || typeof raw.lookupKeys !== "object") {
      return { mac: DEFAULT_LOOKUP_KEY, win: DEFAULT_LOOKUP_KEY };
    }
    const keys = raw.lookupKeys as Partial<PerPlatformLookupKeys>;
    return { mac: keys.mac || DEFAULT_LOOKUP_KEY, win: keys.win || DEFAULT_LOOKUP_KEY };
  }

  function detectWordLanguage(word: string): string {
    if (CJK_REGEX.test(word)) return "ja";
    if (HANGUL_REGEX.test(word)) return "ko";
    if (GERMAN_FEATURE_CHARS.test(word)) return "de";
    if (SPANISH_FEATURE_CHARS.test(word)) return "es";
    if (FRENCH_FEATURE_CHARS.test(word)) return "fr";
    return "en";
  }

  function buildWordPattern(languages: string[]): RegExp {
    // Put "en" last so accented-language patterns (supersets of the ASCII-only en
    // pattern) match a whole word including diacritics instead of fragmenting it.
    const ordered = [
      ...languages.filter((l) => l !== "en"),
      ...(languages.includes("en") ? ["en"] : []),
    ];
    const patterns = ordered.map((lang) => LANGUAGE_WORD_PATTERNS[lang]).filter(Boolean);
    const combined = patterns.length > 0 ? patterns.join("|") : LANGUAGE_WORD_PATTERNS.en;
    return new RegExp(combined, "g");
  }

  function extractSentence(text: string, word: string): string {
    const idx = text.indexOf(word);
    if (idx < 0) return text.slice(0, 120);
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + 80);
    return text.slice(start, end);
  }

  function computeWordSignature(word: string, start: number, end: number, text: string): string {
    return `${word.toLowerCase()}|${start}|${end}|${text}`;
  }

  const LANG_LABELS: Record<string, string> = {
    en: "英语", fr: "法语", es: "西班牙语", de: "德语", ko: "韩语", ja: "日语",
  };
  const LANG_SHORT_LABELS: Record<string, string> = {
    en: "[英]", fr: "[法]", es: "[西]", de: "[德]", ko: "[한]", ja: "[日]",
  };

  const currentPlatform = detectPlatform();

  interface Settings {
    lookupKeys: PerPlatformLookupKeys;
    hoverDelay: number;
    autoSpeak: boolean;
    fireworksEffect: FireworksEffect;
    recognizeLanguages: string[];
  }

  const DEFAULT_SETTINGS: Settings = {
    lookupKeys: {
      mac: DEFAULT_LOOKUP_KEY,
      win: DEFAULT_LOOKUP_KEY,
    },
    hoverDelay: 100,
    autoSpeak: false,
    fireworksEffect: "canvas",
    recognizeLanguages: ["en"],
  };

  const CJK_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
  const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
  const CJK_PUNCT_REGEX = /^[\u3000-\u303F\uFF00-\uFFEF\s]+$/;

  interface TinySegmenter {
    segment(text: string): string[];
  }

  let segmenterInstance: TinySegmenter | null = null;
  function getSegmenter(): TinySegmenter | null {
    if (segmenterInstance) return segmenterInstance;
    if (typeof (window as unknown as { TinySegmenter?: new () => TinySegmenter }).TinySegmenter === "function") {
      segmenterInstance = new (window as unknown as { TinySegmenter: new () => TinySegmenter }).TinySegmenter();
      return segmenterInstance;
    }
    return null;
  }

  function isCJKChar(ch: string): boolean {
    return CJK_REGEX.test(ch);
  }

  function isHangulChar(ch: string): boolean {
    return HANGUL_REGEX.test(ch);
  }

  function getActiveLookupKey(): LookupKey {
    return settings.lookupKeys?.[currentPlatform] || DEFAULT_LOOKUP_KEY;
  }



  function isLanguageEnabled(lang: string): boolean {
    return (settings.recognizeLanguages || ["en"]).includes(lang);
  }



  let wordPattern: RegExp = buildWordPattern(["en"]);
  const EXCLUDED_SELECTOR = "input, textarea, [contenteditable='true'], [contenteditable=''], pre, code";
  const CURSOR_STYLE_ID = "word-picker-cursor-style";
  const HIGHLIGHT_STYLE_ID = "word-picker-highlight-style";
  const HIGHLIGHT_NAME = "word-picker-hover";
  const POPUP_WIDTH = 320;
  const PEN_CURSOR_DATA_URL =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cpath fill='%234472C4' d='M19.73 5.33a2 2 0 0 0-2.83 0l-1.42 1.42 4.24 4.24 1.42-1.42a2 2 0 0 0 0-2.83l-1.41-1.41Z'/%3E%3Cpath fill='%23FFFFFF' d='m14.07 8.1 4.24 4.24-8.84 8.84-4.98 1.13 1.13-4.98 8.45-8.45Z'/%3E%3Cpath fill='%231F2A44' d='m6.54 17.99 1.47-1.47 1.94 1.94-1.48 1.47-1.93.44.44-1.93Z'/%3E%3C/g%3E%3C/svg%3E";

  let currentState: State = STATE.IDLE;
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let hoverTimer: number | null = null;
  let keydownPopupTimer: number | null = null;
  let popupHost: HTMLDivElement | null = null;
  let popupShadow: ShadowRoot | null = null;
  let popupContainer: HTMLDivElement | null = null;
  let toastHost: HTMLDivElement | null = null;
  let toastShadow: ShadowRoot | null = null;
  let toastTimer: number | null = null;
  let toastNode: HTMLDivElement | null = null;
  let activeAnchor = { x: 0, y: 0 };
  let currentLookup: CurrentLookup | null = null;
  let latestRequestToken = 0;
  let lookupKeyPressed = false;
  let isUpdatingPopup = false;
    let isClosingPopup = false;
  let isPreservingPopup = false;
  let pendingPopupFocus = false;
  let popupFocusDesired = false;
  let wordHighlight: Highlight | null = null;

  let imageOverlayHost: HTMLDivElement | null = null;
  let currentImageElement: HTMLImageElement | null = null;
  let ocrRequestToken = 0;

  const KEYDOWN_POPUP_DELAY_MS = 100;
  const VIEWPORT_CHANGE_THROTTLE_MS = 100;

  let rafPending = false;
  let pendingHighlightX = 0;
  let pendingHighlightY = 0;

  let viewportChangeTimer: number | null = null;
  let pendingViewportChange = false;

  interface DetectionResult {
    word: string;
    node: Node;
    text: string;
    start: number;
    end: number;
    offset: number;
  }

  interface CurrentLookup extends DetectionResult {
    signature: string;
    translation?: TranslationData;
    sourceLang?: string;
  }

  interface TranslationData {
    word: string;
    phonetic?: string;
    meaning: string;
    exampleEn?: string;
    exampleZh?: string;
    sentence?: string;
    note?: string;
    error?: boolean;
    provider?: string;
    audio?: string;
  }

  interface SourceRange {
    startXPath: string;
    startOffset: number;
    endXPath: string;
    endOffset: number;
  }

  initialize();

  async function initialize(): Promise<void> {
    await loadSettings();
    bindEvents();
  }

  async function loadSettings(): Promise<void> {
    try {
      const response = await sendMessage({ type: "GET_SETTINGS" });
      const raw: Record<string, unknown> = (response.settings as Record<string, unknown>) || {};
      raw.lookupKeys = normalizeLookupKeys(raw);
      delete (raw as Record<string, unknown>).lookupKey;
      settings = {
        ...DEFAULT_SETTINGS,
        ...raw,
      } as Settings;
      wordPattern = buildWordPattern(settings.recognizeLanguages || ["en"]);
    } catch (error) {
      _logger.warn("加载设置失败，使用默认设置：", error);
      settings = { ...DEFAULT_SETTINGS };
      wordPattern = buildWordPattern(["en"]);
    }
  }

  let visibilityChangeHandler: (() => void) | null = null;

  function bindEvents(): void {
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("wheel", handleWheelWhilePinned, { capture: true, passive: true });
    document.addEventListener("focusin", handleFocusInWhilePinned, true);
    window.addEventListener("blur", exitPenMode, true);
    window.addEventListener("resize", handleViewportChange, true);
    (chrome as any).storage.onChanged.addListener(handleStorageChange);
    visibilityChangeHandler = () => {
      if (document.hidden) {
        exitPenMode();
        getFireworksAPI().clearFireworks();
      }
    };
    document.addEventListener("visibilitychange", visibilityChangeHandler);
    window.addEventListener("pagehide", unbindEvents);
  }

  function unbindEvents(): void {
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("keyup", handleKeyUp, true);
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("scroll", handleViewportChange, true);
    document.removeEventListener("wheel", handleWheelWhilePinned, { capture: true, passive: true } as AddEventListenerOptions);
    document.removeEventListener("focusin", handleFocusInWhilePinned, true);
    window.removeEventListener("blur", exitPenMode, true);
    window.removeEventListener("resize", handleViewportChange, true);
    (chrome as any).storage.onChanged.removeListener(handleStorageChange);
    if (visibilityChangeHandler) {
      document.removeEventListener("visibilitychange", visibilityChangeHandler);
      visibilityChangeHandler = null;
    }
    if (viewportChangeTimer !== null) {
      self.clearTimeout(viewportChangeTimer);
      viewportChangeTimer = null;
    }
    window.removeEventListener("pagehide", unbindEvents);
  }

  function handleStorageChange(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string): void {
    if (areaName !== "local" || !changes.settings?.newValue) {
      return;
    }

    const raw = changes.settings.newValue as Record<string, unknown>;
    raw.lookupKeys = normalizeLookupKeys(raw);
    delete (raw as Record<string, unknown>).lookupKey;

    settings = {
      ...DEFAULT_SETTINGS,
      ...raw,
    } as Settings;
    wordPattern = buildWordPattern(settings.recognizeLanguages || ["en"]);
    exitPenMode();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && (popupContainer || imageOverlayHost)) {
      event.preventDefault();
      isPreservingPopup = false;
      closePopupAndReset();
      return;
    }

    if (event.repeat) {
      return;
    }

    if (isLookupKeyEvent(event)) {
      if (isPopupPinned() && currentLookup) {
        event.preventDefault();
        event.stopPropagation();
        const lookup = currentLookup;
        void saveLookupWordWithFeedback(lookup);
        return;
      }

      // 如果有固定的弹窗但没有有效 lookup，直接重置
      if (isPopupPinned()) {
        closePopupAndReset();
        return;
      }

      lookupKeyPressed = true;
      if (currentState === STATE.IDLE) {
        enterPenMode();
      }
      scheduleInitialLookupAfterKeydown();
    }
  }

  function handleKeyUp(event: KeyboardEvent): void {
    if (!isLookupKeyEvent(event)) {
      return;
    }

    if (isLookupModifierStillHeld(event)) {
      return;
    }

    lookupKeyPressed = false;
    leavePenMode({ preservePopup: Boolean(popupContainer) });
  }

  function isLookupModifierStillHeld(event: KeyboardEvent): boolean {
    return event.getModifierState(getActiveLookupKey());
  }

  function isLookupKeyEvent(event: KeyboardEvent): boolean {
    if (!event) {
      return false;
    }

    if (event.key !== getActiveLookupKey()) {
      return false;
    }

    const activeKey = getActiveLookupKey();
    const otherModifiers: Array<"Control" | "Meta" | "Alt" | "Shift"> = ["Control", "Meta", "Alt", "Shift"].filter(k => k !== activeKey) as Array<"Control" | "Meta" | "Alt" | "Shift">;
    for (const mod of otherModifiers) {
      if (event.getModifierState(mod)) {
        return false;
      }
    }

    return true;
  }

  function enterPenMode(): void {
    currentState = currentState === STATE.SHOWING || currentState === STATE.LOADING ? currentState : STATE.PEN;
    applyCursor();
  }

  interface LeavePenOptions {
    preservePopup?: boolean;
  }

  function leavePenMode({ preservePopup = false }: LeavePenOptions = {}): void {
    clearHoverTimer();
    clearKeydownPopupTimer();
    removeCursor();
    clearWordHighlight();
    if (currentState === STATE.OCR_LOADING || currentState === STATE.IMAGE_OVERLAY) {
      clearImageOverlay();
      currentState = preservePopup && popupContainer?.isConnected ? STATE.SHOWING : STATE.IDLE;
    }
    if (preservePopup && popupContainer?.isConnected) {
      isPreservingPopup = true;
      popupFocusDesired = true;
      currentState = currentState === STATE.LOADING ? STATE.LOADING : STATE.SHOWING;
      positionPopup(popupContainer, activeAnchor.x, activeAnchor.y);
      requestAnimationFrame(() => {
        if (popupContainer?.isConnected) {
          positionPopup(popupContainer, activeAnchor.x, activeAnchor.y);
          if (currentState === STATE.LOADING) {
            pendingPopupFocus = true;
            return;
          }
          pendingPopupFocus = false;
          popupFocusDesired = true;
          focusPopup();
        }
        isPreservingPopup = false;
      });
      return;
    }
    closePopupAndReset();
  }

  function exitPenMode(): void {
    lookupKeyPressed = false;
    isPreservingPopup = false;
    closePopupAndReset();
  }

  function closePopupAndReset(): void {
    if (isPreservingPopup) return;
    isClosingPopup = true;
    clearHoverTimer();
    clearKeydownPopupTimer();
    latestRequestToken += 1;
    ocrRequestToken += 1;
    lookupKeyPressed = false;
    pendingPopupFocus = false;
    popupFocusDesired = false;
    hidePopup();
    currentLookup = null;
    currentState = STATE.IDLE;
    removeCursor();
    clearWordHighlight();
    clearImageOverlay();
    isClosingPopup = false;
  }

  function scheduleInitialLookupAfterKeydown(): void {
    clearKeydownPopupTimer();
    keydownPopupTimer = window.setTimeout(() => {
      keydownPopupTimer = null;
      if (!lookupKeyPressed) {
        return;
      }
      if (popupContainer?.isConnected) {
        return;
      }
      if (currentState !== STATE.PEN && currentState !== STATE.IDLE) {
        return;
      }
      void lookupAtPoint(activeAnchor.x, activeAnchor.y);
    }, KEYDOWN_POPUP_DELAY_MS);
  }

  function clearKeydownPopupTimer(): void {
    if (keydownPopupTimer) {
      clearTimeout(keydownPopupTimer);
      keydownPopupTimer = null;
    }
  }

  function isPopupPinned(): boolean {
    return Boolean(
      popupContainer
      && !lookupKeyPressed
      && (currentState === STATE.SHOWING || currentState === STATE.LOADING)
    );
  }

  function isFocusInsidePopup(): boolean {
    const activeElement = popupShadow?.activeElement;
    return Boolean(activeElement && popupContainer?.contains(activeElement));
  }

  function handleViewportChange(): void {
    if (imageOverlayHost && currentImageElement) {
      const rect = currentImageElement.getBoundingClientRect();
      imageOverlayHost.style.left = `${rect.left}px`;
      imageOverlayHost.style.top = `${rect.top}px`;
      imageOverlayHost.style.width = `${rect.width}px`;
      imageOverlayHost.style.height = `${rect.height}px`;
    }

    if (!popupContainer || isPopupPinned()) {
      return;
    }

    if (viewportChangeTimer !== null) {
      pendingViewportChange = true;
      return;
    }
    positionPopup(popupContainer, activeAnchor.x, activeAnchor.y);
    viewportChangeTimer = self.setTimeout(() => {
      viewportChangeTimer = null;
      if (pendingViewportChange) {
        pendingViewportChange = false;
        if (popupContainer && !isPopupPinned()) {
          positionPopup(popupContainer, activeAnchor.x, activeAnchor.y);
        }
      }
    }, VIEWPORT_CHANGE_THROTTLE_MS);
  }

  function handleWheelWhilePinned(): void {
    if (!isPopupPinned()) {
      return;
    }

    requestAnimationFrame(() => {
      focusPopup();
    });
  }

  function handleFocusInWhilePinned(event: FocusEvent): void {
    if (!isPopupPinned() || isPreservingPopup) {
      return;
    }

    if (currentState === STATE.LOADING) {
      return;
    }

    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.includes(popupHost as EventTarget) || path.includes(popupContainer as EventTarget)) {
      return;
    }

    closePopupAndReset();
  }

  function handleMouseMove(event: MouseEvent): void {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (popupHost && path.includes(popupHost)) {
      return;
    }
    activeAnchor = { x: event.clientX, y: event.clientY };

    if (!lookupKeyPressed) {
      return;
    }

    if (currentState === STATE.IMAGE_OVERLAY) {
      return;
    }

    const imageDetection = IMAGE_OCR_ENABLED ? detectImageAtPoint(event.clientX, event.clientY) : null;
    if (imageDetection) {
      clearWordHighlight();

      if (currentState === STATE.OCR_LOADING && currentImageElement === imageDetection.element) {
        return;
      }

      clearHoverTimer();
      const delay = Math.max(0, Number(settings.hoverDelay) || DEFAULT_SETTINGS.hoverDelay);
      hoverTimer = window.setTimeout(() => {
        void performImageOcr(imageDetection);
      }, delay);
      return;
    }

    if (currentState === STATE.OCR_LOADING) {
      clearImageOverlay();
      currentState = STATE.PEN;
    }

    // 即时高亮鼠标指向的单词（独立于弹窗的 hoverDelay，体验更跟手）
    updateHoverHighlight(event.clientX, event.clientY);

    if (currentState !== STATE.PEN && currentState !== STATE.SHOWING) {
      return;
    }

    clearHoverTimer();

    const delay = Math.max(0, Number(settings.hoverDelay) || DEFAULT_SETTINGS.hoverDelay);
    hoverTimer = window.setTimeout(() => {
      void lookupAtPoint(event.clientX, event.clientY);
    }, delay);
  }

  function updateHoverHighlight(x: number, y: number): void {
    pendingHighlightX = x;
    pendingHighlightY = y;
    if (rafPending) {
      return;
    }
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const detection = detectWordAtPoint(pendingHighlightX, pendingHighlightY);
      if (detection?.node) {
        highlightWord(detection.node, detection.start, detection.end);
      } else {
        clearWordHighlight();
      }
    });
  }

  async function lookupAtPoint(x: number, y: number): Promise<void> {
    const detection = detectWordAtPoint(x, y);
    if (!detection) {
      if (lookupKeyPressed && currentState !== STATE.LOADING) {
        hidePopup();
        currentState = STATE.PEN;
        currentLookup = null;
      }
      return;
    }

    const signature = computeWordSignature(detection.word, detection.start, detection.end, detection.text);
    if (currentLookup?.signature === signature && (currentState === STATE.LOADING || currentState === STATE.SHOWING)) {
      positionPopup(popupContainer!, x, y);
      return;
    }

    _logger.debug('lookupAtPoint', { word: detection.word, x, y });
    const detectedLang = detectWordLanguage(detection.word);
    if (!isLanguageEnabled(detectedLang)) {
      updatePopup({
        word: detection.word,
        phonetic: "",
        meaning: `当前未启用${LANG_LABELS[detectedLang] || detectedLang}识别，请在设置中勾选`,
        exampleEn: "",
        exampleZh: "",
        sentence: extractSentenceFromDetection(detection),
        error: true,
      });
      currentState = STATE.SHOWING;
      return;
    }
    currentLookup = {
      ...detection,
      signature,
      sourceLang: detectedLang,
    };
    currentState = STATE.LOADING;
    showPopup(x, y, buildLoadingData(detection.word));

    const requestToken = ++latestRequestToken;

    try {
      // 检查网络状态
      if (!navigator.onLine) {
        updatePopup({
          word: detection.word,
          phonetic: "",
          meaning: "当前处于离线状态，无法获取翻译",
          exampleEn: "",
          exampleZh: "",
          sentence: extractSentenceFromDetection(detection),
          error: true,
        });
        currentState = STATE.SHOWING;
        return;
      }

      const response = await sendMessage({
        type: "TRANSLATE",
        word: detection.word,
        sourceLang: detectedLang,
      });

      if (requestToken !== latestRequestToken || currentLookup?.signature !== signature) {
        return;
      }

      const translation = (response.translation as TranslationData) || buildLoadingData(detection.word);
      currentLookup.translation = translation;
      _logger.debug('lookupAtPoint translation received', { word: detection.word, provider: translation.provider });
      updatePopup({
        ...translation,
        sentence: extractSentenceFromDetection(detection),
      });
      currentState = STATE.SHOWING;

      if (pendingPopupFocus) {
        pendingPopupFocus = false;
        isPreservingPopup = false;
        popupFocusDesired = true;
        focusPopup();
      }

      if (settings.autoSpeak) {
        speakWord(translation.word || detection.word, currentLookup?.sourceLang || "en");
      }
    } catch (error) {
      if (requestToken !== latestRequestToken || currentLookup?.signature !== signature) {
        return;
      }

      updatePopup({
        word: detection.word,
        phonetic: "",
        meaning: error instanceof Error ? error.message : "翻译失败，请稍后再试",
        exampleEn: "",
        exampleZh: "",
        sentence: extractSentenceFromDetection(detection),
        error: true,
      });
      currentState = STATE.SHOWING;

      if (pendingPopupFocus) {
        pendingPopupFocus = false;
        isPreservingPopup = false;
        popupFocusDesired = true;
        focusPopup();
      }
    }
  }

  function detectWordAtPoint(x: number, y: number): DetectionResult | null {
    if (isExcludedArea(x, y)) {
      return null;
    }

    const caret = getCaretAtPoint(x, y);
    if (!caret || !caret.node || caret.node.nodeType !== Node.TEXT_NODE) {
      return null;
    }

    const text = caret.node.textContent || "";
    if (!text.trim()) {
      return null;
    }

    const offset = Math.max(0, Math.min(caret.offset, text.length));

    if (offset < text.length && isCJKChar(text[offset]) && isLanguageEnabled("ja")) {
      const segmenter = getSegmenter();
      if (segmenter) {
        const segments = segmenter.segment(text);
        let pos = 0;
        for (const seg of segments) {
          const segStart = pos;
          const segEnd = pos + seg.length;
          if (offset >= segStart && offset < segEnd) {
            if (!CJK_PUNCT_REGEX.test(seg)) {
              return {
                word: seg,
                node: caret.node,
                text,
                start: segStart,
                end: segEnd,
                offset,
              };
            }
            break;
          }
          pos = segEnd;
        }
      }
    }

    if (offset < text.length && isHangulChar(text[offset]) && isLanguageEnabled("ko")) {
      let start = offset;
      let end = offset;
      while (start > 0 && isHangulChar(text[start - 1])) start--;
      while (end < text.length && isHangulChar(text[end])) end++;
      const word = text.slice(start, end);
      if (word.length > 0) {
        return { word, node: caret.node, text, start, end, offset };
      }
    }

    const matches = [...text.matchAll(wordPattern)];

    for (const match of matches) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (offset >= start && offset <= end) {
        const word = match[0];
        if (/^[A-Z'-]+$/.test(word) && word.length <= 3) {
          return null;
        }

        return {
          word,
          node: caret.node,
          text,
          start,
          end,
          offset,
        };
      }
    }

    return null;
  }

  interface CaretPosition {
    node: Node;
    offset: number;
  }

  function getCaretAtPoint(x: number, y: number): CaretPosition | null {
    if (typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(x, y);
      if (!position) {
        return null;
      }
      return {
        node: position.offsetNode,
        offset: position.offset,
      };
    }

    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(x, y);
      if (!range) {
        return null;
      }
      return {
        node: range.startContainer,
        offset: range.startOffset,
      };
    }

    return null;
  }

  function isExcludedArea(x: number, y: number): boolean {
    const element = document.elementFromPoint(x, y);
    if (!element) {
      return true;
    }
    if (popupHost && (element === popupHost || popupHost.contains(element))) {
      return true;
    }
    return Boolean(element.closest(EXCLUDED_SELECTOR));
  }

  function extractSentenceFromDetection(detection: DetectionResult): string {
    if (!detection?.text) {
      return "";
    }

    const boundary = /[.!?;\n\r]/;
    let start = detection.start;
    let end = detection.end;

    while (start > 0 && !boundary.test(detection.text[start - 1])) {
      start -= 1;
    }

    while (end < detection.text.length && !boundary.test(detection.text[end])) {
      end += 1;
    }

    return detection.text.slice(start, end).trim().replace(/\s+/g, " ");
  }

  interface ImageDetection {
    element: HTMLImageElement;
    rect: DOMRect;
    src: string;
  }

  function detectImageAtPoint(x: number, y: number): ImageDetection | null {
    const element = document.elementFromPoint(x, y);
    if (!element) return null;
    if (popupHost && (element === popupHost || popupHost.contains(element))) return null;
    if (imageOverlayHost && (element === imageOverlayHost || imageOverlayHost.contains(element))) return null;

    const img = element.closest('img') as HTMLImageElement | null;
    if (!img || !img.src) return null;
    if (img.naturalWidth === 0 || img.naturalHeight === 0) return null;

    const rect = img.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 30) return null;

    return { element: img, rect, src: img.src };
  }

  async function performImageOcr(detection: ImageDetection): Promise<void> {
    const token = ++ocrRequestToken;
    currentImageElement = detection.element;

    if (isSafari()) {
      currentState = STATE.SHOWING;
      showPopup(detection.rect.left + detection.rect.width / 2, detection.rect.top + 20, {
        word: "图片识别",
        phonetic: "",
        meaning: "当前浏览器暂不支持图片识别",
        exampleEn: "",
        exampleZh: "",
        error: true,
      });
      return;
    }

    currentState = STATE.OCR_LOADING;

    showPopup(detection.rect.left + detection.rect.width / 2, detection.rect.top + 20, {
      word: "图片识别",
      phonetic: "",
      meaning: "正在识别图片中的文字...",
      exampleEn: "",
      exampleZh: "",
    });

    try {
      const response = await sendMessage({
        type: "IMAGE_OCR",
        imageUrl: detection.src,
      }, 120000);

      if (token !== ocrRequestToken) return;

      const ocrResult = response.ocrResult as {
        words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
        imageWidth: number;
        imageHeight: number;
      } | undefined;

      if (!ocrResult || !ocrResult.words || ocrResult.words.length === 0) {
        updatePopup({
          word: "图片识别",
          phonetic: "",
          meaning: "未识别到图片中的文字",
          exampleEn: "",
          exampleZh: "",
          error: true,
        });
        currentState = STATE.SHOWING;
        return;
      }

      currentState = STATE.IMAGE_OVERLAY;
      hidePopup();
      showImageOverlay(detection, ocrResult);
    } catch (error) {
      if (token !== ocrRequestToken) return;
      updatePopup({
        word: "图片识别",
        phonetic: "",
        meaning: error instanceof Error ? error.message : "图片识别失败",
        exampleEn: "",
        exampleZh: "",
        error: true,
      });
      currentState = STATE.SHOWING;
    }
  }

  function showImageOverlay(
    detection: ImageDetection,
    ocrResult: { words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>; imageWidth: number; imageHeight: number }
  ): void {
    clearImageOverlay();

    const imgRect = detection.rect;
    const scaleX = imgRect.width / ocrResult.imageWidth;
    const scaleY = imgRect.height / ocrResult.imageHeight;

    imageOverlayHost = document.createElement("div");
    imageOverlayHost.id = "word-picker-image-overlay";
    imageOverlayHost.style.position = "fixed";
    imageOverlayHost.style.left = `${imgRect.left}px`;
    imageOverlayHost.style.top = `${imgRect.top}px`;
    imageOverlayHost.style.width = `${imgRect.width}px`;
    imageOverlayHost.style.height = `${imgRect.height}px`;
    imageOverlayHost.style.zIndex = "2147483646";
    imageOverlayHost.style.pointerEvents = "auto";

    for (const word of ocrResult.words) {
      if (!word.text || !word.text.trim()) continue;
      const cleanText = word.text.trim();
      if (word.confidence < 30) continue;
      if (!/[A-Za-z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\u00C0-\u00FF\uAC00-\uD7AF]/.test(cleanText)) continue;
      if (cleanText.length <= 1 && !/[\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF]/.test(cleanText)) continue;

      const hotspot = document.createElement("div");
      hotspot.className = "wp-ocr-hotspot";
      hotspot.style.position = "absolute";
      hotspot.style.left = `${word.bbox.x0 * scaleX}px`;
      hotspot.style.top = `${word.bbox.y0 * scaleY}px`;
      hotspot.style.width = `${(word.bbox.x1 - word.bbox.x0) * scaleX}px`;
      hotspot.style.height = `${(word.bbox.y1 - word.bbox.y0) * scaleY}px`;
      hotspot.style.pointerEvents = "auto";
      hotspot.style.cursor = "pointer";
      hotspot.title = cleanText;

      hotspot.addEventListener("mouseenter", () => {
        hotspot.style.background = "rgba(137, 180, 250, 0.45)";
        hotspot.style.color = "#fff";
        hotspot.style.textShadow = "0 0 2px rgba(0,0,0,0.6)";
        hotspot.textContent = cleanText;
        hotspot.style.fontSize = `${Math.max(10, Math.min(16, (word.bbox.y1 - word.bbox.y0) * scaleY * 0.7))}px`;
        hotspot.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        hotspot.style.display = "flex";
        hotspot.style.alignItems = "center";
        hotspot.style.justifyContent = "center";
        hotspot.style.overflow = "hidden";
        hotspot.style.borderRadius = "2px";
        hotspot.style.fontWeight = "600";
      });

      hotspot.addEventListener("mouseleave", () => {
        hotspot.style.background = "transparent";
        hotspot.style.color = "transparent";
        hotspot.textContent = "";
      });

      hotspot.addEventListener("click", (e) => {
        e.stopPropagation();
        const rect = hotspot.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        triggerWordLookup(cleanText, cx, cy);
      });

      imageOverlayHost.appendChild(hotspot);
    }

    document.documentElement.appendChild(imageOverlayHost);
  }

  function clearImageOverlay(): void {
    if (imageOverlayHost) {
      imageOverlayHost.remove();
      imageOverlayHost = null;
    }
    currentImageElement = null;
  }

  async function triggerWordLookup(word: string, x: number, y: number): Promise<void> {
    currentState = STATE.LOADING;
    showPopup(x, y, buildLoadingData(word));

    const detectedLang = detectWordLanguage(word);
    const requestToken = ++latestRequestToken;
    try {
      const response = await sendMessage({ type: "TRANSLATE", word, sourceLang: detectedLang });
      if (requestToken !== latestRequestToken) return;

      const translation = (response.translation as TranslationData) || buildLoadingData(word);
      currentLookup = {
        word,
        node: document.createTextNode(word),
        text: word,
        start: 0,
        end: word.length,
        offset: 0,
        signature: computeWordSignature(word, 0, word.length, word),
        translation,
        sourceLang: detectedLang,
      };
      updatePopup(translation);
      currentState = STATE.SHOWING;
    } catch (error) {
      if (requestToken !== latestRequestToken) return;
      updatePopup({
        word,
        phonetic: "",
        meaning: error instanceof Error ? error.message : "翻译失败",
        exampleEn: "",
        exampleZh: "",
        error: true,
      });
      currentState = STATE.SHOWING;
    }
  }

  function buildLoadingData(word: string): TranslationData {
    return {
      word,
      phonetic: "",
      meaning: "正在查询翻译...",
      exampleEn: "",
      exampleZh: "",
      sentence: currentLookup ? extractSentenceFromDetection(currentLookup) : "",
    };
  }

  function createPopupHost(): void {
    popupHost = document.createElement("div");
    popupHost.id = "word-picker-popup-host";
    popupHost.style.position = "fixed";
    popupHost.style.inset = "0";
    popupHost.style.width = "100%";
    popupHost.style.height = "100%";
    popupHost.style.pointerEvents = "none";
    popupHost.style.zIndex = "2147483647";
    document.documentElement.appendChild(popupHost);
    popupShadow = popupHost.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = POPUP_CSS;
    popupShadow.appendChild(style);
  }

  function removeAllPopupContainers(): void {
    if (popupShadow) {
      popupShadow.querySelectorAll(".popup-container").forEach((node) => {
        try {
          if (node.isConnected) {
            node.remove();
          }
        } catch {
          // node already removed
        }
      });
    }
    popupContainer = null;
  }

  function copyPopupPosition(fromElement: HTMLElement, toElement: HTMLElement): void {
    if (!fromElement || !toElement) {
      return;
    }

    if (fromElement.style.left) {
      toElement.style.left = fromElement.style.left;
    }
    if (fromElement.style.top) {
      toElement.style.top = fromElement.style.top;
    }
  }

  function showPopup(x: number, y: number, data: TranslationData): void {
    activeAnchor = { x, y };
    if (!popupHost) {
      createPopupHost();
    }

    removeAllPopupContainers();
    popupContainer = buildPopupElement(data);
    popupShadow!.appendChild(popupContainer);
    positionPopup(popupContainer, x, y);
    requestAnimationFrame(() => {
      if (popupContainer?.isConnected) {
        positionPopup(popupContainer, activeAnchor.x, activeAnchor.y);
      }
    });
  }

  function updatePopup(data: TranslationData): void {
    if (!popupContainer?.isConnected) {
      showPopup(activeAnchor.x, activeAnchor.y, data);
      if (popupFocusDesired) {
        focusPopup();
      }
      return;
    }

    isUpdatingPopup = true;
    const previousContainer = popupContainer;
    const nextContainer = buildPopupElement(data);
    copyPopupPosition(previousContainer, nextContainer);
    if (!previousContainer.isConnected) {
      showPopup(activeAnchor.x, activeAnchor.y, data);
      isUpdatingPopup = false;
      if (popupFocusDesired) {
        focusPopup();
      }
      return;
    }
    try {
      previousContainer.replaceWith(nextContainer);
    } catch {
      showPopup(activeAnchor.x, activeAnchor.y, data);
      isUpdatingPopup = false;
      if (popupFocusDesired) {
        focusPopup();
      }
      return;
    }
    popupContainer = nextContainer;
    // 内容更新时保持弹窗当前像素位置不变，避免不同语言内容高度差异
    // 触发 positionPopup 重算导致翻转/偏移。仅在缺少位置信息时兜底重算。
    if (!nextContainer.style.left || !nextContainer.style.top) {
      positionPopup(nextContainer, activeAnchor.x, activeAnchor.y);
    }
    isUpdatingPopup = false;
    if (popupFocusDesired) {
      focusPopup();
    }
  }

  function showLangDropdown(langTag: HTMLSpanElement): void {
    const wrap = langTag.closest(".popup-lang-wrap") || langTag.parentElement;
    const existingDropdown = wrap?.querySelector(".popup-lang-dropdown");
    if (existingDropdown) {
      existingDropdown.remove();
      return;
    }
    const configuredLangs = settings.recognizeLanguages || ["en"];
    if (configuredLangs.length <= 1) return;
    const currentLang = langTag.getAttribute("data-current-lang") || "en";
    const dropdown = document.createElement("div");
    dropdown.className = "popup-lang-dropdown";
    dropdown.innerHTML = configuredLangs.map(code => {
      const label = code.toUpperCase();
      const active = code === currentLang ? " active" : "";
      return `<div class="popup-lang-option${active}" data-lang="${escapeHtml(code)}">${label}</div>`;
    }).join("");
    wrap?.appendChild(dropdown);
    dropdown.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("popup-lang-option")) return;
      const newLang = target.getAttribute("data-lang");
      if (!newLang || newLang === currentLang) {
        dropdown.remove();
        return;
      }
      currentState = STATE.LOADING;
      isPreservingPopup = true;
      dropdown.remove();
      handleLanguageSwitch(newLang);
    });
  }

  async function handleLanguageSwitch(newLang: string): Promise<void> {
    const lookup = currentLookup;
    if (!lookup?.word) return;
    const word = lookup.word;
    lookup.sourceLang = newLang;
    currentState = STATE.LOADING;
    const requestToken = ++latestRequestToken;
    try {
      const response = await sendMessage({ type: "TRANSLATE", word, sourceLang: newLang });
      if (requestToken !== latestRequestToken) return;
      const translation = (response.translation as TranslationData) || buildLoadingData(word);
      lookup.translation = translation;
      updatePopup({
        ...translation,
        sentence: lookup.text ? extractSentence(lookup.text, lookup.word) : undefined,
      });
      currentState = STATE.SHOWING;
      isPreservingPopup = false;
      focusPopup();
    } catch (error) {
      if (requestToken !== latestRequestToken) return;
      updatePopup({
        word,
        phonetic: "",
        meaning: error instanceof Error ? error.message : "翻译失败",
        exampleEn: "",
        exampleZh: "",
        error: true,
      });
      currentState = STATE.SHOWING;
      isPreservingPopup = false;
      focusPopup();
    }
  }



  function buildPopupElement(data: TranslationData): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "popup-container";
    container.tabIndex = -1;
    const noteMarkup = data.note ? `<div class="popup-note">${escapeHtml(data.note)}</div>` : "";
    const exampleMarkup = data.exampleEn || data.exampleZh
      ? `
        <div class="popup-example">
          ${data.exampleEn ? `<p>${escapeHtml(data.exampleEn)}</p>` : ""}
          ${data.exampleZh ? `<p>${escapeHtml(data.exampleZh)}</p>` : ""}
        </div>
      `
      : "";
    const sentenceMarkup = data.sentence
      ? `<div class="popup-sentence">上下文：${escapeHtml(data.sentence)}</div>`
      : "";
    const currentLang = currentLookup?.sourceLang || "en";
    const langLabel = currentLang.toUpperCase();
    const configuredLangs = settings.recognizeLanguages || ["en"];
    const langDropdownMarkup = configuredLangs.length > 1
      ? `<span class="popup-lang-wrap"><span class="popup-lang-tag" data-current-lang="${escapeHtml(currentLang)}">${langLabel} ▾</span></span>`
      : "";

    container.innerHTML = `
      <div class="popup-header">
        <span class="popup-word">${escapeHtml(data.word || "")}</span>
        ${langDropdownMarkup}
        <button class="popup-close" type="button" aria-label="关闭">×</button>
      </div>
      <div class="popup-phonetic-row">
        <div class="popup-phonetic">${escapeHtml(data.phonetic || "")}</div>
        ${data.audio ? `<button class="btn-audio" type="button" title="播放发音">▶</button>` : ""}
      </div>
      <div class="popup-source-lang">${LANG_SHORT_LABELS[currentLang] || ""}</div>
      <div class="popup-meaning ${data.error ? "is-error" : ""}">${escapeHtml(data.meaning || "")}</div>
      ${noteMarkup}
      ${exampleMarkup}
      ${sentenceMarkup}
      <div class="popup-actions">
        <button class="btn-save" type="button">添加到单词本</button>
      </div>
      <div class="popup-brand-bar">
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="5" height="10" rx="1" fill="#f59e0b"/>
          <rect x="9" y="3" width="5" height="9" rx="1" fill="#fbbf24"/>
          <rect x="5" y="5" width="6" height="5" rx="1.2" fill="#f97316"/>
          <path d="M7 7h4M7 9h4M7 11h3" stroke="#fff" stroke-width="1" stroke-linecap="round"/>
        </svg>
        <span>WordPicker</span>
      </div>
    `;

    container.addEventListener("focusout", (event) => {
      window.setTimeout(() => {
        if (isUpdatingPopup || !popupContainer || isClosingPopup || isPreservingPopup) {
          return;
        }

        if (event.currentTarget !== popupContainer) {
          return;
        }

        if (lookupKeyPressed) {
          return;
        }

        if (currentState === STATE.LOADING) {
          return;
        }

        if (isFocusInsidePopup()) {
          return;
        }

        if (event.relatedTarget && popupContainer.contains(event.relatedTarget as Node)) {
          return;
        }

        if (!isPopupPinned()) {
          return;
        }

        closePopupAndReset();
      }, 0);
    });

    container.querySelector(".popup-close")!.addEventListener("click", () => {
      closePopupAndReset();
    });

    const audioBtn = container.querySelector(".btn-audio") as HTMLButtonElement | null;
    if (audioBtn && data.audio) {
      audioBtn.addEventListener("click", () => {
        const audio = new Audio(data.audio);
        audio.play().catch(() => {});
      });
    }

    const langTag = container.querySelector(".popup-lang-tag") as HTMLSpanElement | null;
    if (langTag) {
      langTag.addEventListener("click", (e) => {
        e.stopPropagation();
        showLangDropdown(langTag);
      });
    }

    container.querySelector(".btn-save")!.addEventListener("click", async () => {
      if (!currentLookup?.translation) {
        return;
      }

      let response;
      try {
        response = await sendMessage({
          type: "SAVE_WORD",
          entry: buildWordEntry(currentLookup),
        });
      } catch (error) {
        showToast(error instanceof Error ? error.message : "保存失败");
        return;
      }

      if (response.duplicate) {
        showToast("已添加");
        safeClosePopupAndReset();
        return;
      }

      if (response.saved) {
        showToast("添加成功");
        getFireworksAPI().launchFireworks(settings.fireworksEffect, activeAnchor.x, activeAnchor.y);
        safeClosePopupAndReset();
        return;
      }

      showToast("保存失败");
    });

    return container;
  }

  function focusPopup(): void {
    if (!popupContainer) {
      return;
    }

    popupContainer.focus({ preventScroll: true });
  }

  function positionPopup(element: HTMLElement, mouseX: number, mouseY: number): void {
    if (!element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const width = rect.width || POPUP_WIDTH;
    const height = rect.height || 220;
    let left = mouseX + 12;
    let top = mouseY + 12;

    if (left + width > window.innerWidth) {
      left = mouseX - width - 12;
    }
    if (top + height > window.innerHeight) {
      top = mouseY - height - 12;
    }

    element.style.left = `${Math.max(8, left)}px`;
    element.style.top = `${Math.max(8, top)}px`;
  }

  function hidePopup(): void {
    removeAllPopupContainers();
  }

  function ensureToastHost(): void {
    if (toastHost && toastShadow) {
      return;
    }

    toastHost = document.createElement("div");
    toastHost.id = "word-picker-toast-host";
    toastHost.style.position = "fixed";
    toastHost.style.left = "0";
    toastHost.style.top = "0";
    toastHost.style.zIndex = "2147483647";
    document.documentElement.appendChild(toastHost);
    toastShadow = toastHost.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = TOAST_CSS;
    toastShadow.appendChild(style);
  }

  function showToast(message: string): void {
    ensureToastHost();

    if (!toastShadow) {
      return;
    }

    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    if (toastNode) {
      toastNode.remove();
      toastNode = null;
    }

    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    toastNode = node;
    toastShadow.appendChild(node);

    // 根据内容长度动态调整显示时间（最少 1.4 秒，每 10 字符加 200 毫秒）
    const displayDuration = Math.max(1400, message.length * 200);
    toastTimer = window.setTimeout(() => {
      if (toastNode === node) {
        node.remove();
        toastNode = null;
      }
      toastTimer = null;
    }, displayDuration);
  }

  // 序列化 DOM 节点为 XPath（用于精确定位回原文）
  function getElementXPath(element: Node | null): string {
    if (!element) return '';
    if (element instanceof Element && element.id) return `//*[@id="${CSS.escape(element.id)}"]`;
    const path: string[] = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      for (let sibling: Node | null = element.previousSibling; sibling; sibling = sibling.previousSibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === element.nodeName) {
          index++;
        }
      }
      path.unshift(`${element.nodeName.toLowerCase()}[${index}]`);
      element = element.parentNode;
    }
    return '/' + path.join('/');
  }

  function getNodeXPath(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const parentXPath = getElementXPath(node.parentNode);
      const textNodes = Array.from(node.parentNode!.childNodes as NodeListOf<ChildNode>).filter(n => n.nodeType === Node.TEXT_NODE);
      const textIndex = textNodes.indexOf(node as ChildNode) + 1;
      return `${parentXPath}/text()[${textIndex}]`;
    }
    return getElementXPath(node as Element);
  }

  function serializeRange(node: Node, start: number, end: number): SourceRange {
    const xpath = getNodeXPath(node);
    return {
      startXPath: xpath,
      startOffset: start,
      endXPath: xpath,
      endOffset: end,
    };
  }

  function buildTextFragmentUrl(baseUrl: string, text: string): string {
    const cleanUrl = baseUrl.split('#')[0];
    const maxLen = 80;
    const fragment = text.length > maxLen ? text.slice(0, maxLen) : text;
    return `${cleanUrl}#:~:text=${encodeURIComponent(fragment)}`;
  }

  function buildWordEntry(lookup: CurrentLookup): {
    word: string;
    frequency: number;
    translation: string;
    timeAdded: number;
    timeUpdated: number;
    contexts: Array<{
      context: string;
      timeAdded: number;
      sourceLink: string;
      sourceRange?: SourceRange;
      translation: string;
    }>;
    sourceLang?: string;
    _legacy: {
      id: string;
      phonetic: string;
      exampleEn: string;
      exampleZh: string;
      sourceUrl: string;
      sourceTitle: string;
      tags: string[];
      createdAt: number;
      reviewCount: number;
    };
  } {
    const sentence = extractSentenceFromDetection(lookup);
    const now = Date.now();

    // 构建上下文对象
    interface ContextEntry {
      context: string;
      timeAdded: number;
      sourceLink: string;
      sourceRange?: SourceRange;
      translation: string;
    }
    const contexts: ContextEntry[] = [];
    if (sentence) {
      const sourceLink = buildTextFragmentUrl(window.location.href, sentence);
      const sourceRange = lookup.node
        ? serializeRange(lookup.node, lookup.start, lookup.end)
        : undefined;
      contexts.push({
        context: sentence,
        timeAdded: now,
        sourceLink,
        sourceRange,
        translation: "",
      });
    }

    return {
      word: lookup.translation!.word || lookup.word,
      frequency: contexts.length || 1,
      translation: lookup.translation!.meaning || "",
      timeAdded: now,
      timeUpdated: now,
      contexts: contexts,
      // 语言感知：把采集时识别到的源语言（detectWordLanguage 或用户手动覆盖）一并保存
      sourceLang: lookup.sourceLang,
      // 保留旧数据作为兼容
      _legacy: {
        id: (crypto as Crypto).randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        phonetic: lookup.translation!.phonetic || "",
        exampleEn: lookup.translation!.exampleEn || "",
        exampleZh: lookup.translation!.exampleZh || "",
        sourceUrl: window.location.href,
        sourceTitle: document.title,
        tags: [],
        createdAt: now,
        reviewCount: 0,
      },
    };
  }

  async function saveLookupWord(lookup: CurrentLookup): Promise<SendMessageResponse> {
    if (!lookup?.translation) {
      throw new Error("单词翻译数据无效");
    }

    return await sendMessage({
      type: "SAVE_WORD",
      entry: buildWordEntry(lookup),
    });
  }

  async function saveLookupWordWithFeedback(lookup: CurrentLookup): Promise<void> {
    if (!lookup?.translation || !popupContainer?.isConnected) {
      closePopupAndReset();
      return;
    }

    let response;
    try {
      response = await saveLookupWord(lookup);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存失败");
      return;
    }

    if (response.duplicate) {
      showToast("已添加");
      safeClosePopupAndReset();
      return;
    }

    if (response.saved) {
      showToast("添加成功");
      getFireworksAPI().launchFireworks(settings.fireworksEffect, activeAnchor.x, activeAnchor.y);
      safeClosePopupAndReset();
      return;
    }

    showToast("保存失败");
  }

  function safeClosePopupAndReset(): void {
    window.setTimeout(() => {
      try {
        closePopupAndReset();
      } catch (error) {
        _logger.warn("关闭弹窗时出现异常：", error);
      }
    }, 0);
  }

  const LANG_VOICE_MAP: Record<string, string> = {
    en: "en-US",
    fr: "fr-FR",
    es: "es-ES",
    de: "de-DE",
    ko: "ko-KR",
    ja: "ja-JP",
  };

  function speakWord(word: string, sourceLang: string = "en"): void {
    if (!("speechSynthesis" in window) || !word) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    const lang = LANG_VOICE_MAP[sourceLang] || "en-US";
    utterance.lang = lang;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    const voice = pickVoiceForLang(sourceLang);
    if (voice) {
      utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  }

  function pickVoiceForLang(lang: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) {
      return null;
    }
    const langPrefix = LANG_VOICE_MAP[lang] || "en";
    const langCode = langPrefix.split("-")[0];
    const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(langCode.toLowerCase()));
    const pool = langVoices.length > 0 ? langVoices : voices;

    const google = pool.find((v) => /google/i.test(v.name));
    if (google) {
      return google;
    }
    return pool[0] || null;
  }

  // voices 列表异步加载：首次就绪后无需额外动作，下次 speakWord 会自动取到
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }

  function applyCursor(): void {
    let style = document.getElementById(CURSOR_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = CURSOR_STYLE_ID;
      document.documentElement.appendChild(style);
    }

    style.textContent = `
      html, html * {
        cursor: url("${PEN_CURSOR_DATA_URL}") 0 24, crosshair !important;
      }
    `;
  }

  function removeCursor(): void {
    const style = document.getElementById(CURSOR_STYLE_ID);
    if (style) {
      style.remove();
    }
  }

  // 初始化 CSS Custom Highlight（用于在按住唤起键时高亮鼠标指向的单词）
  function ensureWordHighlight(): Highlight | null {
    if (typeof Highlight === "undefined" || !CSS?.highlights) {
      return null;
    }
    if (!wordHighlight) {
      wordHighlight = new Highlight();
      CSS.highlights.set(HIGHLIGHT_NAME, wordHighlight);
    }
    if (!document.getElementById(HIGHLIGHT_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = HIGHLIGHT_STYLE_ID;
      style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: Highlight; color: HighlightText; }`;
      document.documentElement.appendChild(style);
    }
    return wordHighlight;
  }

  // 高亮指定文本节点内 [start, end) 区间的单词，效果与划词选中一致
  function highlightWord(node: Node, start: number, end: number): void {
    const highlight = ensureWordHighlight();
    if (!highlight || !node) {
      return;
    }
    try {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      highlight.clear();
      highlight.add(range);
    } catch {
      highlight.clear();
    }
  }

  function clearWordHighlight(): void {
    if (wordHighlight) {
      wordHighlight.clear();
    }
  }

  function clearHoverTimer(): void {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  const POPUP_CSS = `
    :host {
      all: initial;
    }

    .popup-container {
      position: fixed;
      width: ${POPUP_WIDTH}px;
      box-sizing: border-box;
      pointer-events: auto;
      background: #1e1e2e;
      border: 1px solid #45475a;
      border-radius: 10px;
      padding: 14px;
      color: #cdd6f4;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.5;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
      z-index: 2147483647;
      outline: none;
    }

    .popup-container:focus,
    .popup-container:focus-within {
      border-color: #89b4fa;
      box-shadow: 0 0 0 1px rgba(137, 180, 250, 0.4), 0 12px 32px rgba(0, 0, 0, 0.45);
    }

    .popup-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .popup-word {
      font-size: 18px;
      font-weight: 700;
      color: #f5f7ff;
      word-break: break-word;
      flex: 1;
      min-width: 0;
    }

    .popup-lang-wrap {
      position: relative;
      display: inline-flex;
    }

    .popup-lang-tag {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background: #30363d;
      color: #8b949e;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      position: relative;
    }

    .popup-lang-tag:hover {
      background: #484f58;
      color: #c9d1d9;
    }

        .popup-lang-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 4px 0;
      z-index: 10;
      min-width: 60px;
    }

    .popup-lang-option {
      padding: 6px 12px;
      font-size: 12px;
      color: #c9d1d9;
      cursor: pointer;
      text-align: center;
    }

    .popup-lang-option:hover {
      background: #30363d;
    }

    .popup-lang-option.active {
      color: #58a6ff;
      font-weight: 600;
    }

    .popup-close {
      background: transparent;
      border: none;
      color: #a6adc8;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
    }

    .popup-phonetic {
      font-size: 13px;
      color: #8b949e;
      min-height: 19px;
    }

    .popup-phonetic-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .btn-audio {
      background: transparent;
      border: 1px solid #45475a;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #89b4fa;
      font-size: 10px;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    .btn-audio:hover {
      background: #313244;
      border-color: #89b4fa;
    }

    .popup-source-lang {
      font-size: 12px;
      color: #8b949e;
      margin-top: 2px;
    }

    .popup-meaning {
      margin-top: 8px;
      color: #d9def7;
    }

    .popup-meaning.is-error {
      color: #ffb4b4;
    }

    .popup-note,
    .popup-sentence {
      margin-top: 8px;
      font-size: 12px;
      color: #a6adc8;
    }

    .popup-example {
      margin-top: 10px;
      padding-left: 10px;
      border-left: 2px solid #45475a;
      color: #a6adc8;
      font-size: 13px;
      font-style: italic;
    }

    .popup-example p {
      margin: 4px 0;
    }

    .popup-actions {
      margin-top: 12px;
    }

    .btn-save {
      width: 100%;
      border: none;
      border-radius: 8px;
      padding: 9px 12px;
      background: #89b4fa;
      color: #11213e;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .btn-save:hover {
      background: #74c7ec;
    }

    .btn-save:disabled {
      opacity: 0.75;
      cursor: default;
    }

    .popup-brand-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #313244;
    }

    .popup-brand-bar svg {
      width: 16px;
      height: 16px;
    }

    .popup-brand-bar span {
      font-size: 11px;
      color: #a6adc8;
      font-weight: 500;
      letter-spacing: 0.2px;
    }
  `;

  const TOAST_CSS = `
    :host {
      all: initial;
    }

    .toast {
      position: fixed;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      box-sizing: border-box;
      max-width: min(520px, calc(100vw - 24px));
      padding: 10px 14px;
      border-radius: 10px;
      background: rgba(13, 17, 23, 0.92);
      border: 1px solid rgba(48, 54, 61, 0.9);
      color: #f0f6fc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.2px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
      z-index: 2147483647;
      animation: toast-in 0.15s ease-out, toast-out 0.2s ease-in 1.2s forwards;
      pointer-events: none;
      text-align: center;
      line-height: 1.4;
      user-select: none;
    }

    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    @keyframes toast-out {
      to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    }
  `;
})();
