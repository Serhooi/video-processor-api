// Тест заглавных букв
const fs = require('fs');

function splitPhraseToLines(words, maxWordsPerLine = 5) {
  if (words.length <= maxWordsPerLine) {
    return [words];
  }
  const maxTotalWords = maxWordsPerLine * 2;
  const wordsToUse = words.length > maxTotalWords ? words.slice(0, maxTotalWords) : words;
  const midPoint = Math.ceil(wordsToUse.length / 2);
  return [wordsToUse.slice(0, midPoint), wordsToUse.slice(midPoint)];
}

function assTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

const testSegments = [
  {
    words: [
      { word: "Привет", start: 0.0, end: 0.5 },
      { text: "мир", start: 0.5, end: 1.0 },
      { Word: "как", start: 1.0, end: 1.3 },
      { Text: "дела", start: 1.3, end: 1.8 }
    ]
  }
];

const activeColor = '&H00D7FF&';
const whiteColor = '&HFFFFFF&';
const blackShadow = '&H000000&';
const baseFontSize = 46;
const activeFontSize = 53;

let ass = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,46,&HFFFFFF&,&H00D7FF&,&H000000&,&H000000&,1,0,0,0,100,100,0,0,1,2,2,2,60,60,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

console.log('🔤 Тест заглавных букв:');
console.log('');

testSegments.forEach((seg, i) => {
  if (Array.isArray(seg.words) && seg.words.length > 0) {
    const validWords = seg.words.filter(word => {
      const wordText = (word.text || word.word || word.Text || word.Word || '').toUpperCase();
      return wordText.trim() !== '' && typeof word.start === 'number' && typeof word.end === 'number';
    });

    const wordsToProcess = validWords.slice(0, 10);

    console.log('Исходные слова:', seg.words.map(w => w.word || w.text || w.Word || w.Text).join(' '));
    console.log('Заглавными:', wordsToProcess.map(w => (w.text || w.word || w.Text || w.Word || '').toUpperCase()).join(' '));

    // Для каждого слова создаем отдельный диалог где только оно активное
    for (let j = 0; j < wordsToProcess.length; j++) {
      const w = wordsToProcess[j];
      const start = assTime(w.start);
      
      let endTime = w.end;
      if (j < wordsToProcess.length - 1) {
        const nextWord = wordsToProcess[j + 1];
        if (nextWord.start > w.end) {
          endTime = nextWord.start - 0.01;
        }
      }
      
      const end = assTime(endTime);

      const lines = splitPhraseToLines(wordsToProcess, 5);
      let phrase = lines.map(lineWords =>
        lineWords.map((word) => {
          const wordText = (word.text || word.word || word.Text || word.Word || '').toUpperCase();
          const globalIdx = wordsToProcess.indexOf(word);

          if (globalIdx === j) {
            // Активное слово: цветное и увеличенное
            return `{\\c${activeColor}\\b1\\shad3\\4c${blackShadow}\\fs${activeFontSize}}${wordText}{\\r}`;
          } else {
            // Обычное слово: белое обычного размера
            return `{\\c${whiteColor}\\b1\\shad3\\4c${blackShadow}\\fs${baseFontSize}}${wordText}{\\r}`;
          }
        }).filter(text => text.trim() !== '').join(' ')
      ).filter(line => line.trim() !== '').join('\\N');

      if (phrase.trim()) {
        ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${phrase}\n`;
      }
    }
  }
});

fs.writeFileSync('test_uppercase.ass', ass, 'utf8');
console.log('\n✅ Создан тестовый файл: test_uppercase.ass');
console.log('\n🎯 Результат:');
console.log('- Все слова преобразованы в заглавные буквы');
console.log('- Работает с разными полями (word, text, Word, Text)');
console.log('- Сохранена логика активного выделения');