# Используем Node.js образ с FFmpeg
FROM node:18-alpine

# Установим зависимости для ffmpeg и рендеринга субтитров
RUN apk add --no-cache curl ca-certificates fontconfig freetype ttf-dejavu

# Скачиваем и устанавливаем статический ffmpeg с поддержкой всех фильтров
RUN curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ -C /usr/local/bin --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe'

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