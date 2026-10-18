'use strict';
const db = require('../config/db');
const User = require('../models/User');
const Client = require('../models/Client');
const {
  normalizeString,
  requireFields,
  validatePassword,
  validateEmail,
  validatePhone,
} = require('../utils/validators');
const {
  ValidationError,
  AuthError,
  ConflictError,
} = require('../errors');

/**
 * Контроллер аутентификации и регистрации.
 * Обслуживает два пути:
 *   - серверный рендеринг HTML-форм входа и регистрации под `/auth/*`;
 *   - REST-эндпоинты под `/api/auth/*`, принимающие и возвращающие JSON.
 */
function wantsJson(req) {
  const originalUrl = req.originalUrl || '';
  const path = req.path || '';
  if (originalUrl.startsWith('/api') || path.startsWith('/api')) return true;
  const accept = (req.headers && req.headers.accept) || '';
  return typeof accept === 'string' && accept.includes('application/json');
}

function defaultRedirect(user) {
  const code = (user && user.role && user.role.code) || (user && user.role_code);
  if (code === 'admin') return '/admin';
  if (code === 'master') return '/account/master';
  return '/account';
}

function buildSessionUser(user) {
  const role = user.role
    || { id: user.role_id, code: user.role_code, name: user.role_name };
  return {
    id: user.id,
    login: user.login,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    role,
    role_code: (user.role && user.role.code) || user.role_code,
  };
}

/**
 * Кешированный id роли `client`. Таблица `roles` заполняется `scripts/seed.js`
 * и не меняется при работе приложения, поэтому один раз прочитанный id можно
 * хранить на уровне модуля.
 */
let _clientRoleId = null;
async function getClientRoleId() {
  if (_clientRoleId) return _clientRoleId;
  const [rows] = await db.query(
    'SELECT id FROM roles WHERE code = ? LIMIT 1',
    ['client']
  );
  if (!rows.length) {
    throw new Error('Role "client" missing — run seed.js');
  }
  _clientRoleId = rows[0].id;
  return _clientRoleId;
}

function sanitizeForm(body) {
  const source = body && typeof body === 'object' ? body : {};
  const { password, password2, ...rest } = source;
  return rest;
}

function showLogin(req, res) {
  if (req.session && req.session.user) {
    return res.redirect(defaultRedirect(req.session.user));
  }
  return res.render('auth/login', {
    title: 'Вход',
    error: null,
    form: {},
  });
}

function showRegister(req, res) {
  if (req.session && req.session.user) {
    return res.redirect(defaultRedirect(req.session.user));
  }
  return res.render('auth/register', {
    title: 'Регистрация',
    error: null,
    form: {},
  });
}

async function register(req, res, next) {
  const isJson = wantsJson(req);
  const body = req.body || {};

  const login = normalizeString(body.login, { maxLen: 64 }) || '';
  const password = typeof body.password === 'string' ? body.password : '';
  const password2 = typeof body.password2 === 'string' ? body.password2 : undefined;
  const full_name = normalizeString(body.full_name, { maxLen: 128 }) || '';
  const email = normalizeString(body.email, { maxLen: 128 }) || '';
  const phone = normalizeString(body.phone, { maxLen: 32 }) || '';

  const errors = [];
  const missing = requireFields(
    { login, password, full_name, email, phone },
    ['login', 'password', 'full_name', 'email', 'phone']
  );
  for (const field of missing) {
    errors.push({ field, message: 'Поле обязательно для заполнения' });
  }
  if (!missing.includes('login') && (login.length < 3 || login.length > 64)) {
    errors.push({ field: 'login', message: 'Логин должен быть от 3 до 64 символов' });
  }
  if (!missing.includes('password') && !validatePassword(password)) {
    errors.push({ field: 'password', message: 'Пароль должен содержать 8..128 символов без пробелов' });
  }
  if (password2 !== undefined && password2 !== password) {
    errors.push({ field: 'password2', message: 'Пароли не совпадают' });
  }
  if (!missing.includes('full_name') && full_name.length < 2) {
    errors.push({ field: 'full_name', message: 'Укажите корректное ФИО' });
  }
  if (!missing.includes('email') && !validateEmail(email)) {
    errors.push({ field: 'email', message: 'Некорректный email' });
  }
  if (!missing.includes('phone') && !validatePhone(phone)) {
    errors.push({ field: 'phone', message: 'Некорректный номер телефона' });
  }

  if (errors.length > 0) {
    if (isJson) {
      return next(new ValidationError('Ошибка валидации', { errors }));
    }
    return res.status(400).render('auth/register', {
      title: 'Регистрация',
      error: errors[0].message,
      form: sanitizeForm(body),
    });
  }

  try {
    const roleId = await getClientRoleId();
    const user = await User.create({
      login,
      password,
      role_id: roleId,
      full_name,
      email,
      phone,
    });
    await Client.create(user.id, { birth_date: null, notes: null });

    req.session.user = buildSessionUser(user);
    req.session.userId = user.id;

    if (isJson) {
      return res.status(201).json({ user: req.session.user });
    }
    return res.redirect('/account');
  } catch (err) {
    if (err instanceof ConflictError) {
      if (isJson) return next(err);
      return res.status(409).render('auth/register', {
        title: 'Регистрация',
        error: 'Логин, email или телефон уже заняты',
        form: sanitizeForm(body),
      });
    }
    return next(err);
  }
}

async function login(req, res, next) {
  const isJson = wantsJson(req);
  const body = req.body || {};
  const loginValue = typeof body.login === 'string' ? body.login.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const unifiedMsg = 'Неверный логин или пароль';

  try {
    const user = loginValue ? await User.findByLogin(loginValue) : null;
    // 👇 ДОБАВЬТЕ ЭТУ СТРОКУ ДЛЯ ОТЛАДКИ 👇
    console.log('DEBUG LOGIN:', { loginValue, found: !!user, isActive: user?.is_active, hash: user?.password_hash });
    const ok = user && user.is_active && User.verifyPassword(user, password);

    if (!ok) {
      if (isJson) return next(new AuthError(unifiedMsg));
      return res.status(401).render('auth/login', {
        title: 'Вход',
        error: unifiedMsg,
        form: { login: loginValue },
      });
    }

    req.session.user = buildSessionUser(user);
    req.session.userId = user.id;

    const returnTo = req.session.returnTo;
    delete req.session.returnTo;

    if (isJson) {
      return res.json({ user: req.session.user });
    }
    return res.redirect(returnTo || defaultRedirect(user));
  } catch (err) {
    return next(err);
  }
}

function logout(req, res) {
  const isJson = wantsJson(req);

  const finalize = () => {
    if (isJson) return res.status(204).end();
    return res.redirect('/');
  };

  if (!req.session || typeof req.session.destroy !== 'function') {
    return finalize();
  }
  req.session.destroy(() => finalize());
}

function me(req, res, next) {
  if (req.session && req.session.user) {
    return res.json({ user: req.session.user });
  }
  return next(new AuthError());
}

module.exports = {
  showLogin,
  showRegister,
  register,
  login,
  logout,
  me,
};