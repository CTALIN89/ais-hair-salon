# Документация интеграций: АИС «Салон-парикмахерская HAIR SALON»

## 1. CI/CD Pipeline

### 1.1. Выбранная платформа

**GitHub Actions** — встроен в GitHub, бесплатен для публичных репозиториев, поддерживает matrix-сборки.

### 1.2. Стадии пайплайна

```
┌────────────┐    ┌────────────┐   ┌────────────┐    ┌────────────┐   ┌────────────┐
│   Lint     │──▶│   Test     │──▶│  Security  │──▶│   Build    │──▶│   Deploy   │
│            │    │            │   │            │    │  (Docker)  │   │  (main)    │
└────────────┘    └────────────┘   └────────────┘    └────────────┘   └────────────┘
   ESLint            Mocha+Chai      npm audit         docker build      SSH+pm2
   (планируется)     37 тестов                        + smoke test      на VPS
```

### 1.3. Конфигурация

См. `.github/workflows/ci.yml`.

### 1.4. Секреты GitHub Actions

Для работы `deploy` нужны секреты (Settings → Secrets → Actions):
- `DEPLOY_HOST` — IP/домен сервера.
- `DEPLOY_USER` — SSH-пользователь.
- `DEPLOY_SSH_KEY` — приватный SSH-ключ.

### 1.5. Проверка работы

```cmd
git add .
git commit -m "test: проверка CI/CD"
git push origin main
```

На вкладке **Actions** в GitHub → виден запущенный пайплайн.

## 2. OAuth2 — Yandex ID

### 2.1. Обоснование выбора

- **Yandex ID** — популярен в РФ, соответствует 152-ФЗ (данные в РФ).
- **Google OAuth** — популярен, но данные в США (риск 152-ФЗ).

### 2.2. Схема авторизации

Клиент → GET /auth/yandex → Yandex OAuth Server
         ↓
Yandex → Login & Consent screen
         ↓
Yandex → GET /auth/yandex/callback?code=...
         ↓
Сервер → Обмен code → access_token
         ↓
Сервер → Получение профиля (email, name)
         ↓
Сервер → Поиск/создание пользователя в БД
         ↓
Сервер → Создание сессии + редирект на /account

### 2.3. Реализация

См. `src/config/passport.js`, `src/routes/index.js`.

### 2.4. Настройка в консоли Yandex

1. [oauth.yandex.ru](https://oauth.yandex.ru/) → «Создать приложение».
2. **Название:** HAIR SALON.
3. **Redirect URI:** `http://localhost:3000/auth/yandex/callback`.
4. **Доступы:** `login:email`, `login:info`.
5. Скопировать **Client ID** и **Client Secret** в `.env`.

### 2.5. Проверка

1. Открыть `http://localhost:3000/auth/login`.
2. Нажать «Войти через Яндекс».
3. Авторизоваться в Yandex.
4. Вернуться на `/account` с активной сессией.


## 3. Аналитика — Яндекс.Метрика

### 3.1. Обоснование

- **Яндекс.Метрика** — бесплатна, соответствует 152-ФЗ, интеграция с Yandex ID.
- **Google Analytics** — популярна, но данные в США.

### 3.2. Подключение

См. `src/views/layout.pug` — код счётчика.

### 3.3. События (reachGoal)

| Событие                   | Когда вызывается     |
|---------------------------|----------------------|
| `registration`            | Успешная регистрация |
| `login`                   | Успешный вход        |
| `appointment_created`     | Создана запись       |
| `appointment_cancelled`   | Отмена               |
| `appointment_rescheduled` | Перенос              |
| `report_generated`        | Сформирован отчёт    |

### 3.4. Проверка

1. Открыть сайт.
2. Открыть DevTools → Network → фильтр `mc.yandex.ru`.
3. Увидеть запросы на метрику.
4. В [metrika.yandex.ru](https://metrika.yandex.ru/) → «Отчёты» → «Содержание» — увидеть посещения.


## 4. Мониторинг

### 4.1. Health Check

**Endpoint:** `GET /health`.

**Ответ (200):**
```json
{
  "status": "ok",
  "timestamp": "2026-10-11T15:00:00.000Z",
  "uptime": 3600.5,
  "database": { "status": "connected", "responseTimeMs": 3 },
  "version": "1.0.0"
}
```

**Ответ (503):**
```json
{
  "status": "error",
  "database": { "status": "disconnected", "error": "..." }
}
```

### 4.2. Внешний мониторинг (опционально)

- **UptimeRobot** — бесплатный, проверяет `/health` каждые 5 минут.
- **Pingdom** — платный, расширенная аналитика.

### 4.3. Настройка UptimeRobot

1. Зарегистрироваться на [uptimerobot.com](https://uptimerobot.com/).
2. Add New Monitor → HTTP(s).
3. URL: `https://your-domain.com/health`.
4. Interval: 5 минут.
5. Alert contacts: email.

## 5. Логирование — Winston

### 5.1. Установка

```bash
npm install winston winston-daily-rotate-file
```

### 5.2. Уровни логирования

| Уровень | Когда используется             |
|---------|--------------------------------|
| `error` | Ошибки, исключения             |
| `warn`  | Предупреждения                 |
| `info`  | Запуск сервера, важные события |
| `debug` | Отладочная информация          |

### 5.3. Формат

JSON — структурированный, удобен для парсинга в ELK/Sentry.

**Пример:**
```json
{
  "level": "error",
  "message": "Request error",
  "timestamp": "2026-10-11T15:00:00.000Z",
  "service": "salon-app",
  "stack": "ValidationError: ...",
  "path": "/api/appointments",
  "method": "POST",
  "user": 4
}
```

### 5.4. Ротация логов

- `logs/error-YYYY-MM-DD.log` — только ошибки (хранение 30 дней).
- `logs/combined-YYYY-MM-DD.log` — все логи (хранение 14 дней).

### 5.5. Анализ логов с AI

**Промпт:**
```
Role: DevOps Engineer
Task: Проанализируй лог-файл и найди причину ошибки.
Context: Лог: <вставить>. Проект: Node.js + Express + MySQL.
Format: 1) Причина. 2) Рекомендации. 3) Возможные исправления.
```

## 6. Тестирование интеграций

### 6.1. Чек-лист

| Интеграция   | Как проверить                       | Ожидаемый результат |
|--------------|-------------------------------------|---------------------|
| CI/CD        | `git push origin main`              | Пайплайн зелёный    |
| OAuth2       | Нажать «Войти через Яндекс»         | Успешный вход       |
| Метрика      | DevTools → Network → `mc.yandex.ru` | Запросы идут        |
| Health Check | `curl http://localhost:3000/health` | `{"status":"ok"}`   |
| Winston      | Проверить `logs/combined-*.log`     | Файлы созданы       |

### 6.2. Пример проверки Health Check

```bash
curl -i http://localhost:3000/health
```

**Ожидаемый ответ:**
```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ok",
  "database": { "status": "connected", "responseTimeMs": 3 }
}
```
