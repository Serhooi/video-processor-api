const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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

// Генерация ASS-файла с поддержкой стилей, karaoke и glow/fade
function createASSContent(segments, videoWidth = 1920, videoHeight = 1080) {
  // Секция Script Info
  let ass = `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: ${videoWidth}\n` +
    `PlayResY: ${videoHeight}\n` +
    `ScaledBorderAndShadow: yes\n` +
    `\n`;

  // Секция стилей (Montserrat, жирный, белый, тень, outline, glow)
  ass += `[V4+ Styles]\n`;
  ass += `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
  // Базовый стиль
  ass += `Style: Default,Montserrat,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,1,2,60,60,60,1\n`;
  // Жёлтый стиль для ключевых слов
  ass += `Style: Highlight,Montserrat,48,&H0000D7FF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,1,2,60,60,60,1\n`;
  // Glow стиль (neon)
  ass += `Style: Neon,Montserrat,48,&H00FFFF00,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,4,2,60,60,60,1\n`;
  ass += `\n`;

  // Секция событий
  ass += `[Events]\n`;
  ass += `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  // Генерируем события для каждого сегмента
  segments.forEach((seg, i) => {
    const start = assTime(seg.start);
    const end = assTime(seg.end);
    // Определяем стиль
    let style = 'Default';
    if (seg.style && seg.style.color && seg.style.color.toUpperCase() === '#FFD700') style = 'Highlight';
    if (seg.style && seg.style.glow) style = 'Neon';
    // Karaoke-эффект (если есть)
    let text = typeof seg.text === 'string' ? seg.text : '';
    if (seg.karaoke) {
      // Длительность в десятках миллисекунд
      const kdur = Math.round((seg.end - seg.start) * 100);
      text = `{\\k${kdur}}${text}`;
    }
    // Fade (если есть)
    if (seg.style && seg.style.fade) {
      text = `{\\fad(200,200)}${text}`;
    }
    // Жирность, цвет, underline, italic (ASS inline-теги)
    let inline = '';
    if (seg.style) {
      if (seg.style.fontWeight && String(seg.style.fontWeight) === '800') inline += '\\b1';
      if (seg.style.italic) inline += '\\i1';
      if (seg.style.underline) inline += '\\u1';
      if (seg.style.color && seg.style.color !== '#FFFFFF' && style === 'Default') {
        // Кастомный цвет
        inline += `\\c&H${hexToAss(seg.style.color)}&`;
      }
      if (seg.style.shadow !== undefined) inline += `\\shad${seg.style.shadow ? 1 : 0}`;
    }
    if (inline) text = `{${inline}}${text}`;
    ass += `Dialogue: 0,${start},${end},${style},,0,0,0,,${text}\n`;
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
  return c.length === 6 ? c.slice(4,6) + c.slice(2,4) + c.slice(0,2) : 'FFFFFF';
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
    const assContent = createASSContent(transcript);
    const assPath = path.join(TEMP_DIR, `${taskId}_subtitles.ass`);
    await fs.writeFile(assPath, assContent, 'utf8');
    
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

app.listen(PORT, () => {
  console.log(`🚀 Video processor API running on port ${PORT}`);
  console.log(`📁 Temp directory: ${TEMP_DIR}`);
  console.log(`📁 Output directory: ${OUTPUT_DIR}`);
});