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
    
    console.log(`📝 Creating SRT file for task ${taskId}`);
    
    // Создаем SRT файл
    const srtContent = createSRTContent(transcript);
    const srtPath = path.join(TEMP_DIR, `${taskId}_subtitles.srt`);
    await fs.writeFile(srtPath, srtContent, 'utf8');
    
    task.progress = 40;
    task.status = 'processing';
    
    console.log(`🎬 Processing video with FFmpeg for task ${taskId}`);
    
    // Обрабатываем видео с FFmpeg
    const outputPath = path.join(OUTPUT_DIR, `${taskId}_output.mp4`);
    const styleString = getFFmpegStyle(style);
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters(`subtitles=${srtPath}:force_style='${styleString}'`)
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
      fs.remove(srtPath).catch(console.error);
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