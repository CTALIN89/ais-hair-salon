'use strict';

const passport = require('passport');
const YandexStrategy = require('passport-yandex').Strategy;
const User = require('../models/User');
const Client = require('../models/Client');
const db = require('./db');

/**
 * Стратегия аутентификации через Yandex ID (OAuth2).
 * Требует переменных окружения YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET.
 */
if (process.env.YANDEX_CLIENT_ID) {
  passport.use(new YandexStrategy({
    clientID: process.env.YANDEX_CLIENT_ID,
    clientSecret: process.env.YANDEX_CLIENT_SECRET,
    callbackURL: process.env.YANDEX_CALLBACK_URL || 'http://localhost:3000/auth/yandex/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('Email не получен от Yandex'));

      // Ищем существующего пользователя
      let user = await User.findByEmail(email);

      if (!user) {
        // Регистрируем нового клиента
        const [roleRows] = await db.query(
          'SELECT id FROM roles WHERE code = ? LIMIT 1',
          ['client']
        );
        if (!roleRows.length) return done(new Error('Роль client не найдена'));

        user = await User.create({
          login: `yandex_${profile.id}`,
          password: require('crypto').randomBytes(16).toString('hex'),
          role_id: roleRows[0].id,
          full_name: profile.displayName || profile.username,
          email,
          phone: profile.phoneNumbers?.[0]?.value || '+70000000000',
        });
        await Client.create(user.id, { birth_date: null, notes: 'Регистрация через Yandex' });
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
}

module.exports = passport;