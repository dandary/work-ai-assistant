# Рабочий ассистент (Next.js + Cerebras)

Веб‑чат с режимами «письма / саммари / задачи / ответы». Запросы к LLM идут через серверный маршрут `/api/assistant` (ключ не попадает в браузер).

## Требования

- Node.js 20+
- Ключ API [Cerebras Cloud](https://cloud.cerebras.ai/)

## Установка

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
```

В `.env.local` укажите `CEREBRAS_API_KEY` (префикс `csk-`).

## Запуск

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) (при занятом порту Next подберёт другой).

## Сборка

```bash
npm run build
npm start
```

## Переменные окружения

См. комментарии в `.env.example` (модель, таймаут, rate limit и т.д.).
