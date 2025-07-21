# Используем Node.js образ с FFmpeg
FROM node:18-alpine

# Установим зависимости для ffmpeg и рендеринга субтитров
RUN apk add --no-cache curl ca-certificates fontconfig freetype ttf-dejavu

# Скачиваем архив во временную папку
RUN curl -L -o /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
    && cp /tmp/ffmpeg-*-static/ffmpeg /usr/local/bin/ \
    && cp /tmp/ffmpeg-*-static/ffprobe /usr/local/bin/ \
    && rm -rf /tmp/ffmpeg*

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Копируем исходный код
COPY . .

# Создаем необходимые директории
RUN mkdir -p temp output

# Открываем порт
EXPOSE 3001

# Запускаем приложение
CMD ["npm", "start"]