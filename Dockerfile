# Используем Node.js образ с FFmpeg
FROM node:18-alpine

# Устанавливаем FFmpeg
RUN apk add --no-cache ffmpeg

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