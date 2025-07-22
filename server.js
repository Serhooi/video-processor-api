const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Создаем папки для временных файлов
const TEMP_DIR = path.join(__dirname, 'temp');
const OUTPUT_DIR = path.join(__dirname, 'output');
fs.ensureDirSync(TEMP_DIR);
fs.ensureDirSync(OUTPUT_DIR);

// Настройка multer для загрузки файлов
const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Хранилище задач
const tasks = new Map();

// Создание SRT файла из transcript
function createSRTContent(transcript, startOffset = 0) {
  let srtContent = '';
  let segmentIndex = 1;

  // Группируем слова в сегменты (2-3 слова)
  const segments = [];
  let currentSegment = [];

  for (let i = 0; i < transcript.length; i++) {
    const word = transcript[i];
    currentSegment.push(word);

    // Создаем сегмент каждые 2-3 слова или при паузах
    if (currentSegment.length >= 3 ||
      (i < transcript.length - 1 && transcript[i + 1].start - word.end > 0.5) ||
      i === transcript.length - 1) {

      segments.push({
        start: currentSegment[0].start - startOffset,
        end: currentSegment[currentSegment.length - 1].end - startOffset,
        text: currentSegment.map(w => w.word).join(' ')
      });
      currentSegment = [];
    }
  }

  // Конвертируем в SRT формат
  segments.forEach(segment => {
    const startTime = formatSRTTime(segment.start);
    const endTime = formatSRTTime(segment.end);

    srtContent += `${segmentIndex}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${segment.text}\n\n`;
    segmentIndex++;
  });

  return srtContent;
}

// Форматирование времени для SRT
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// Получение стилей для FFmpeg
function getFFmpegStyle(style) {
  const styles = {
    modern: "FontName=Arial,FontSize=24,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,Shadow=1",
    neon: "FontName=Arial,FontSize=24,PrimaryColour=&H00FFFF&,OutlineColour=&HFF00FF&,Outline=2,Shadow=1",
    fire: "FontName=Arial,FontSize=24,PrimaryColour=&H0045FF&,OutlineColour=&H00D7FF&,Outline=2,Shadow=1",
    elegant: "FontName=Georgia,FontSize=22,PrimaryColour=&HF5F5F5&,OutlineColour=&H333333&,Outline=1,Shadow=1"
  };

  return styles[style] || styles.modern;
}

function getASSStyles(style, videoWidth = 720, videoHeight = 1280) {
  // Цвета ASS: &HAABBGGRR (BBGGRR, AA — прозрачность)
  // Преобразование hex цвета в ASS
  function hexToAss(hex, alpha = '00') {
    // hex: #RRGGBB, alpha: '00' (opaque) to 'FF' (transparent)
    const r = hex.slice(1, 3);
    const g = hex.slice(3, 5);
    const b = hex.slice(5, 7);
    return `&H${alpha}${b}${g}${r}&`;
  }
  // Маппинг стилей
  const styles = {
    modern: {
      name: 'Default',
      font: 'Montserrat Bold',
      size: Math.round(videoHeight / 13),
      primary: hexToAss('#FFFFFF'),
      karaoke: hexToAss('#FFD700'), // Желтый для модерн стиля
      outlineColor: hexToAss('#000000'),
      backColor: hexToAss('#000000', 'FF'),
      marginV: Math.round(videoHeight / 16),
    },
    neon: {
      name: 'Default',
      font: 'Montserrat Bold',
      size: Math.round(videoHeight / 13),
      primary: hexToAss('#FFFFFF'),
      karaoke: hexToAss('#0000FF'), // Синий для неон стиля
      outlineColor: hexToAss('#000000'),
      backColor: hexToAss('#000000', 'FF'),
      marginV: Math.round(videoHeight / 16),
    },
    fire: {
      name: 'Fire',
      font: 'Montserrat',
      size: videoHeight > videoWidth ? 80 : 48,
      primary: hexToAss('#FF4500'),
      karaoke: hexToAss('#FFD700'),
      outline: 2,
      outlineColor: hexToAss('#FFD700'),
      backColor: '&H90002828', // rgba(40,0,0,0.9)
      bold: -1,
      shadow: 4,
      alignment: 2,
      marginV: 80,
      italic: 0,
      glow: 1
    },
    elegant: {
      name: 'Elegant',
      font: 'Georgia',
      size: videoHeight > videoWidth ? 64 : 44,
      primary: hexToAss('#F5F5DC'),
      karaoke: hexToAss('#D4AF37'),
      outline: 2,
      outlineColor: hexToAss('#8B4513'),
      backColor: '&H800A1414', // rgba(20,20,20,0.5)
      bold: 0,
      shadow: 1,
      alignment: 2,
      marginV: 80,
      italic: 1,
      glow: 0
    }
  };
  return styles[style] || styles.modern;
}

function splitPhraseToLines(words, maxWordsPerLine = 4) {
  // Строго максимум две строки, ограничиваем количество слов
  if (words.length <= maxWordsPerLine) {
    return [words];
  }

  // Если слов больше чем maxWordsPerLine*2, обрезаем до максимума
  const maxTotalWords = maxWordsPerLine * 2;
  const wordsToUse = words.length > maxTotalWords ? words.slice(0, maxTotalWords) : words;

  // Делим на две строки максимально равномерно
  const midPoint = Math.ceil(wordsToUse.length / 2);
  return [wordsToUse.slice(0, midPoint), wordsToUse.slice(midPoint)];
}

function createASSContent(segments, style = 'modern', videoWidth = 720, videoHeight = 1280) {
  style = (typeof style === 'string' ? style.toLowerCase().trim() : 'modern');

  // Цвета для активных слов по стилям (ASS формат: &HBBGGRR&)
  const styleColors = {
    modern: { active: '&H00D7FF&', shadow: '&H8000D7FF&' },  // Желтый (FFD700 -> 00D7FF)
    neon: { active: '&HFFFF00&', shadow: '&H80FFFF00&' },  // Синий (0000FF -> FFFF00)
    fire: { active: '&H0045FF&', shadow: '&H800045FF&' },  // Красно-оранжевый
    elegant: { active: '&H37AF37&', shadow: '&H8037AF37&' }   // Золотой
  };

  const activeColor = styleColors[style] ? styleColors[style].active : styleColors.modern.active;
  const activeShadow = styleColors[style] ? styleColors[style].shadow : styleColors.modern.shadow;
  const whiteColor = '&HFFFFFF&';
  const blackShadow = '&H000000&';
  const baseFontSize = Math.round(videoHeight / 20);
  const activeFontSize = Math.round(baseFontSize * 1.4); // Увеличиваем на 40%
  let ass = `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: ${videoWidth}\n` +
    `PlayResY: ${videoHeight}\n` +
    `ScaledBorderAndShadow: yes\n` +
    `\n`;
  ass += `[V4+ Styles]\n`;
  ass += `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
  ass += `Style: Default,Arial,${baseFontSize},${whiteColor},${whiteColor},${blackShadow},${blackShadow},0,0,0,0,100,100,0,0,1,0,0,2,60,60,${Math.round(videoHeight / 16)},1\n`;
  ass += `\n`;
  ass += `[Events]\n`;
  ass += `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  segments.forEach((seg, i) => {
    if (Array.isArray(seg.words) && seg.words.length > 0) {
      // Для каждого слова — отдельный Dialogue, где только оно подсвечено
      for (let j = 0; j < seg.words.length; j++) {
        const w = seg.words[j];
        const start = assTime(w.start);
        const end = assTime(w.end);
        const lines = splitPhraseToLines(seg.words, 4);
        let lineTexts = lines.map(lineWords =>
          lineWords.map((word, idx) => {
            const wordText = typeof word.text === 'string' ? word.text : (typeof word.word === 'string' ? word.word : '');
            const globalIdx = seg.words.indexOf(word);
            if (globalIdx === j) {
              // Активное слово: цвет по стилю, жирный, увеличенный размер, яркая тень
              return `{\\c${activeColor}\\b1\\shad8\\4c${activeShadow}\\fs${activeFontSize}\\fscx110\\fscy110}${wordText}{\\r}`;
            } else {
              // Обычное слово: белый, стандартный размер
              return `{\\c${whiteColor}\\b1\\shad3\\4c${blackShadow}\\fs${baseFontSize}}${wordText}{\\r}`;
            }
          }).join(' ')
        );
        const phrase = lineTexts.join('\\N');
        ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${phrase}\n`;
      }
    } else {
      const start = assTime(seg.start);
      const end = assTime(seg.end);
      const text = typeof seg.text === 'string' ? seg.text : '';
      ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\c${whiteColor}\\b1\\shad3\\4c${blackShadow}\\fs${baseFontSize}}${text}{\\r}\n`;
    }
  });
  return ass;
}

// Вспомогательная функция: формат времени для ASS
function assTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100); // centiseconds
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}
// Вспомогательная функция: hex #RRGGBB -> ASS BGR
function hexToAss(hex) {
  // #RRGGBB -> BBGGRR
  const c = hex.replace('#', '');
  return c.length === 6 ? c.slice(4, 6) + c.slice(2, 4) + c.slice(0, 2) : 'FFFFFF';
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Video processor API is running' });
});

// Обработка видео с субтитрами
app.post('/api/burn-subtitles', async (req, res) => {
  const taskId = uuidv4();

  try {
    const { videoUrl, transcript, style = 'modern', title = 'video' } = req.body;

    if (!videoUrl || !transcript || !Array.isArray(transcript)) {
      return res.status(400).json({
        error: 'Missing required fields: videoUrl, transcript'
      });
    }

    // Создаем задачу
    tasks.set(taskId, {
      id: taskId,
      status: 'processing',
      progress: 0,
      createdAt: new Date()
    });

    console.log(`🎬 Starting task ${taskId} for video: ${title}`);

    // Запускаем обработку асинхронно
    processVideo(taskId, videoUrl, transcript, style, title);

    res.json({
      taskId,
      status: 'processing',
      message: 'Video processing started'
    });

  } catch (error) {
    console.error('Error starting video processing:', error);
    res.status(500).json({ error: error.message });
  }
});

// Проверка статуса задачи
app.get('/api/task/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

// Скачивание готового видео
app.get('/api/download/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);

  if (!task || task.status !== 'completed' || !task.outputPath) {
    return res.status(404).json({ error: 'Video not ready or not found' });
  }

  if (!fs.existsSync(task.outputPath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  res.download(task.outputPath, task.filename || 'video_with_subtitles.mp4');
});

// Основная функция обработки видео
async function processVideo(taskId, videoUrl, transcript, style, title) {
  const task = tasks.get(taskId);

  try {
    // Обновляем прогресс
    task.progress = 10;
    task.status = 'downloading';

    console.log(`📥 Downloading video for task ${taskId}`);

    // Скачиваем видео
    const videoPath = path.join(TEMP_DIR, `${taskId}_input.mp4`);
    const response = await fetch(videoUrl);

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.writeFile(videoPath, Buffer.from(buffer));

    task.progress = 30;
    task.status = 'preparing';

    console.log(`📝 Creating ASS file for task ${taskId}`);

    // Создаем ASS файл
    const assContent = createASSContent(transcript, style);
    const assPath = path.join(TEMP_DIR, `${taskId}_subtitles.ass`);
    const assDebugPath = path.join(OUTPUT_DIR, `${taskId}_debug.ass`);
    // Логируем путь к debug-файлу
    console.log('ASS debug file saved to:', assDebugPath);
    await fs.writeFile(assPath, assContent, 'utf8');
    await fs.writeFile(assDebugPath, assContent, 'utf8');

    task.progress = 40;
    task.status = 'processing';

    console.log(`🎬 Processing video with FFmpeg for task ${taskId}`);
    console.log('transcript:', transcript);

    // Обрабатываем видео с FFmpeg
    const outputPath = path.join(OUTPUT_DIR, `${taskId}_output.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters(`subtitles=${assPath}`)
        .videoCodec('libx264')
        .audioCodec('copy') // Сохраняем оригинальное аудио
        .outputOptions(['-crf', '20']) // Качество
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🔧 FFmpeg command: ${commandLine}`);
        })
        .on('stderr', (stderrLine) => {
          console.log('FFmpeg stderr:', stderrLine);
        })
        .on('progress', (progress) => {
          const percent = Math.round(40 + (progress.percent || 0) * 0.5);
          task.progress = Math.min(percent, 90);
          console.log(`⏳ Task ${taskId} progress: ${task.progress}%`);
        })
        .on('end', () => {
          console.log(`✅ Task ${taskId} completed successfully`);
          resolve();
        })
        .on('error', (error) => {
          console.error(`❌ FFmpeg error for task ${taskId}:`, error);
          reject(error);
        })
        .run();
    });

    // Завершаем задачу
    task.progress = 100;
    task.status = 'completed';
    task.outputPath = outputPath;
    task.filename = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_with_subtitles.mp4`;
    task.completedAt = new Date();

    console.log(`🎉 Task ${taskId} finished successfully`);

    // Очищаем временные файлы
    setTimeout(() => {
      fs.remove(videoPath).catch(console.error);
      fs.remove(assPath).catch(console.error);
    }, 1000);

  } catch (error) {
    console.error(`❌ Task ${taskId} failed:`, error);
    task.status = 'failed';
    task.error = error.message;
    task.failedAt = new Date();
  }
}

// Очистка старых задач (каждый час)
setInterval(() => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  for (const [taskId, task] of tasks.entries()) {
    if (task.createdAt < oneHourAgo) {
      // Удаляем файл если есть
      if (task.outputPath) {
        fs.remove(task.outputPath).catch(console.error);
      }
      tasks.delete(taskId);
      console.log(`🗑️ Cleaned up old task: ${taskId}`);
    }
  }
}, 60 * 60 * 1000); // Каждый час

exec('ffmpeg -version', (err, stdout, stderr) => {
  if (stdout) console.log('FFmpeg version:', stdout);
  if (stderr) console.log('FFmpeg stderr:', stderr);
});

app.listen(PORT, () => {
  console.log(`🚀 Video processor API running on port ${PORT}`);
  console.log(`📁 Temp directory: ${TEMP_DIR}`);
  console.log(`📁 Output directory: ${OUTPUT_DIR}`);
});