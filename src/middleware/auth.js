'use strict';

const { AuthError, ForbiddenError } = require('../errors');

// Middleware-слой аутентификации и авторизации по ролям.
 
function wantsJson(req) {
  const path = req.path || req.originalUrl || req.url || '';
  if (path.startsWith('/api')) return true;
  const accept = req.headers && req.headers.accept ? String(req.headers.accept) : '';
  return accept.includes('application/json');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  if (wantsJson(req)) {
    return next(new AuthError('Требуется аутентификация'));
  }

  if (req.session) {
    req.session.returnTo = req.originalUrl;
  }
  return res.redirect('/auth/login');
}

function readRoleCode(user) {
  if (!user) return null;
  if (user.role && typeof user.role === 'object' && user.role.code) {
    return String(user.role.code);
  }
  if (user.role_code) return String(user.role_code);
  // На случай, если когда-либо `role` станет строкой — оставляем запасной путь.
  if (typeof user.role === 'string') return user.role;
  return null;
}

function requireRole(roleOrRoles) {
  const allowed = Array.isArray(roleOrRoles) ? roleOrRoles.slice() : [roleOrRoles];

  return function roleGuard(req, res, next) {
    if (!req.session || !req.session.user) {
      if (wantsJson(req)) {
        return next(new AuthError('Требуется аутентификация'));
      }
      if (req.session) {
        req.session.returnTo = req.originalUrl;
      }
      return res.redirect('/auth/login');
    }

    const code = readRoleCode(req.session.user);
    if (!code || !allowed.includes(code)) {
      if (wantsJson(req)) {
        return next(new ForbiddenError('Доступ запрещён'));
      }
      return res.status(403).render('errors/403', { title: 'Доступ запрещён' });
    }

    return next();
  };
}

function attachUserToLocals(req, res, next) {
  res.locals.user = (req.session && req.session.user) || null;
  next();
}

module.exports = { requireAuth, requireRole, attachUserToLocals };