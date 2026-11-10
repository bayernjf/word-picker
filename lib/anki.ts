// Anki TSV 导出：纯函数（无浏览器依赖），供 service worker 与单元测试共用。

export interface AnkiWordInput {
  word: string;
  phonetic?: string;
  translation?: string;
  exampleEn?: string;
  exampleZh?: string;
  contexts?: Array<{ context?: string }>;
  _legacy?: {
    phonetic?: string;
    meaning?: string;
    exampleEn?: string;
    exampleZh?: string;
  };
}

/** HTML 转义 + 去制表符（Anki 导入按 \t 分列）。 */
export function ankiEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, ' ');
}

export function toAnki(words: AnkiWordInput[]): string {
  return words
    .map((word) => {
      const front = ankiEscape(word.word);
      const phonetic = ankiEscape(word.phonetic || word._legacy?.phonetic || '');
      const meaning = ankiEscape(word.translation || word._legacy?.meaning || '');
      const exampleEn = ankiEscape(word.exampleEn || word._legacy?.exampleEn || '');
      const exampleZh = ankiEscape(word.exampleZh || word._legacy?.exampleZh || '');
      const contexts = (word.contexts || [])
        .map((c) => ankiEscape(c.context))
        .filter(Boolean)
        .join('<br>');
      const back = [
        phonetic ? `<i>${phonetic}</i>` : '',
        meaning ? `<div>${meaning}</div>` : '',
        exampleEn ? `<div class="example">${exampleEn}</div>` : '',
        exampleZh ? `<div class="example">${exampleZh}</div>` : '',
        contexts ? `<div class="contexts">${contexts}</div>` : '',
      ]
        .filter(Boolean)
        .join('');
      return `${front}\t${back}`;
    })
    .join('\n');
}
