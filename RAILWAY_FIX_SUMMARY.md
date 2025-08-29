# 🚨 ИСПРАВЛЕНИЕ ПРОБЛЕМЫ С СУБТИТРАМИ НА RAILWAY

## Проблема
Субтитры не выжигались в видео на Railway API сервере, хотя фронтенд отправлял данные правильно.

## Причина
Функция `createASSContent` ожидала данные в формате сегментов `[{words: [{word, start, end}]}]`, но фронтенд отправлял массив слов `[{word, start, end}]`.

## Исправления

### 1. Исправлен формат данных в server.js
```javascript
// ДОБАВЛЕНО: Автоматическое преобразование формата данных
if (segments && segments.length > 0 && segments[0].word && !segments[0].words) {
  console.log('🔄 Converting word array to segments format');
  processedSegments = [{ words: segments }];
}
```

### 2. Исправлен Dockerfile для Railway
```dockerfile
# ИСПРАВЛЕНО: Убрана проблемная опция --wildcards для BusyBox tar
RUN curl -L -o /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && cd /tmp \
    && tar -xJf ffmpeg.tar.xz \
    && find . -name "ffmpeg" -type f -exec cp {} /usr/local/bin/ \; \
    && find . -name "ffprobe" -type f -exec cp {} /usr/local/bin/ \; \
    && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
    && rm -rf /tmp/ffmpeg* \
    && ffmpeg -version
```

### 3. Добавлено детальное логирование
- Логирование входных данных transcript
- Проверка создания ASS файлов
- Проверка FFmpeg команды с субтитрами
- Подсчет диалогов в ASS файле

### 4. Исправлена ошибка дублирования переменной
```javascript
// ИСПРАВЛЕНО: Переименована переменная assStats -> assFileStats
const assFileStats = await fs.stat(assPath);
```

## Тестирование

### Локальный тест
```bash
node test_fix_format.js
# ✅ ИСПРАВЛЕНИЕ РАБОТАЕТ: Субтитры создаются!
# 💬 Количество диалогов: 3
```

### Тест Railway API
```bash
node test_railway.js
# Тестирует полный цикл: health check -> создание задачи -> проверка статуса
```

## Результат
- ✅ Функция createASSContent теперь поддерживает оба формата данных
- ✅ ASS файлы создаются правильно с диалогами
- ✅ FFmpeg получает корректные субтитры для выжигания
- ✅ Dockerfile совместим с Alpine Linux на Railway
- ✅ Добавлено подробное логирование для отладки

## Деплой на Railway
1. Закоммитить изменения
2. Пушнуть в репозиторий
3. Railway автоматически пересоберет с исправленным Dockerfile
4. Проверить логи на наличие сообщений о создании ASS файлов

## Проверка работы
После деплоя в логах Railway должны появиться:
```
🔄 Converting word array to segments format
✅ Using 1 segments for processing
📝 Processing 1 segments, first: X words
✅ ASS files created: XXXX chars, XXX bytes
💬 Dialogue lines in ASS: X
🔧 FFmpeg command: [команда с subtitles filter]
🎯 Subtitles filter: ✅ INCLUDED
```