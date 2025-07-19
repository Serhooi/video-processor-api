# Video Processor API

Серверный API для вжигания субтитров в видео с использованием FFmpeg.

## Возможности

- ✅ Вжигание субтитров в видео файлы
- ✅ Поддержка различных стилей субтитров
- ✅ Сохранение оригинального аудио
- ✅ Асинхронная обработка с отслеживанием прогресса
- ✅ Автоматическая очистка временных файлов

## Установка и запуск

### Локально

```bash
cd video-processor-api
npm install
npm start
```

### Docker

```bash
cd video-processor-api
docker build -t video-processor-api .
docker run -p 3001:3001 video-processor-api
```

### Деплой на Railway

1. Создайте аккаунт на [Railway.app](https://railway.app)
2. Подключите GitHub репозиторий
3. Выберите папку `video-processor-api`
4. Railway автоматически определит Dockerfile и задеплоит

### Деплой на Fly.io

```bash
# Установите flyctl
curl -L https://fly.io/install.sh | sh

# В папке video-processor-api
fly launch
fly deploy
```

## API Endpoints

### POST /api/burn-subtitles
Запускает обработку видео с субтитрами.

**Body:**
```json
{
  "videoUrl": "https://example.com/video.mp4",
  "transcript": [
    {
      "word": "Hello",
      "start": 0.0,
      "end": 0.5
    },
    {
      "word": "world",
      "start": 0.5,
      "end": 1.0
    }
  ],
  "style": "modern",
  "title": "My Video"
}
```

**Response:**
```json
{
  "taskId": "uuid-here",
  "status": "processing",
  "message": "Video processing started"
}
```

### GET /api/task/:taskId
Проверяет статус обработки.

**Response:**
```json
{
  "id": "uuid-here",
  "status": "completed",
  "progress": 100,
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### GET /api/download/:taskId
Скачивает готовое видео.

### GET /health
Проверка работоспособности API.

## Стили субтитров

- `modern` - Arial, белый текст, черная обводка
- `neon` - Arial, голубой текст, розовая обводка  
- `fire` - Arial, оранжевый текст, золотая обводка
- `elegant` - Georgia, светлый текст, тонкая обводка

## Переменные окружения

- `PORT` - порт сервера (по умолчанию 3001)

## Требования

- Node.js 18+
- FFmpeg (устанавливается автоматически в Docker)
- 1GB+ RAM для обработки видео
- Достаточно места на диске для временных файлов