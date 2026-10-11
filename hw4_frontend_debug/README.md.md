# АИС «Салон-парикмахерская HAIR SALON» — Frontend

## Стек
- **Pug 3** — шаблонизатор
- **CSS3** — кастомные свойства, медиа-запросы
- **jQuery 3.7** — AJAX, работа с DOM
- **Google Fonts** — Oswald + Inter

## Запуск

```bash
npm install
copy env.example .env
npm run db:migrate
npm run db:seed
npm start
```

Приложение доступно на [http://localhost:3000](http://localhost:3000).

## Тестирование

```bash
npm test
```

**Ожидаемый результат:** 37 passing, exit code 0.

## Структура Frontend

```
public/
  css/styles.css       # все стили (адаптивные)
  js/app.js            # клиентский JS (AJAX, wizard, admin)
  img/                 # статические изображения
  uploads/             # загруженные файлы (services, masters)

src/views/
  layout.pug           # основной макет
  home.pug             # главная страница
  auth/                # login.pug, register.pug
  services/            # list.pug, detail.pug
  masters/             # list.pug, detail.pug
  appointments/        # book.pug (wizard)
  account/             # client.pug, master.pug
  admin/               # 10 страниц админки
  errors/              # 403.pug, 404.pug, 500.pug
  partials/            # переиспользуемые фрагменты
```

## Основные страницы

| URL                 | Назначение            |
|---------------------|-----------------------|
| `/`                 | Главная               |
| `/services`         | Каталог услуг         |
| `/services/:id`     | Детали услуги         |
| `/masters`          | Список мастеров       |
| `/masters/:id`      | Профиль мастера       |
| `/appointments/new` | Онлайн-записи         |
| `/account`          | Кабинет клиента       |
| `/account/master`   | Кабинет мастера       |
| `/admin/*`          | Админ-панель          |

## Адаптивность

Breakpoints:
- ≤ 700px — мобильные
- 701–1024px — планшеты
- > 1024px — десктопы

Все страницы проверены на разрешениях: 375px, 390px, 768px, 1920px.

## Демо-учётные записи

| Логин   | Пароль    | Роль          |
|---------|-----------|---------------|
| admin   | admin123  | Администратор |
| ivanov  | master123 | Мастер        |
| petrova | master123 | Мастер        |
| client1 | client123 | Клиент        |
| client2 | client123 | Клиент        |

## Дизайн

Тёмная тема «Барбершоп»:
- Основной фон: `#121212`
- Акцент: `#d4a54a` (золото)
- Шрифты: Oswald (заголовки), Inter (текст)
- Стили: `public/css/styles.css`

# АИС «Салон-парикмахерская HAIR SALON» — Frontend

## Запуск
```bash
npm install
copy env.example .env
npm run db:migrate
npm run db:seed
npm start