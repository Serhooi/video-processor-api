# Используем Node.js образ с FFmpeg
FROM node:18-alpine

# Установим зависимости для ffmpeg и рендеринга субтитров
RUN apk add --no-cache curl ca-certificates fontconfig freetype ttf-dejavu

# Скачиваем и устанавливаем статический FFmpeg
RUN curl -L -o /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && cd /tmp \
    && tar -xJf ffmpeg.tar.xz \
    && find . -name "ffmpeg" -type f -exec cp {} /usr/local/bin/ \; \
    && find . -name "ffprobe" -type f -exec cp {} /usr/local/bin/ \; \
    && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
    && rm -rf /tmp/ffmpeg* \
    && ffmpeg -version

# Добавляю Montserrat-Bold.ttf для ASS-стилей
RUN mkdir -p /usr/share/fonts/montserrat \
    && curl -L -o /usr/share/fonts/montserrat/Montserrat-Bold.ttf https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat-Bold.ttf \
    && fc-cache -f -v

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