'use strict';

const express = require('express');
const router = express.Router();

const homeController = require('../controllers/homeController');
const serviceController = require('../controllers/serviceController');
const masterController = require('../controllers/masterController');
const appointmentController = require('../controllers/appointmentController');
const accountController = require('../controllers/accountController');
const adminController = require('../controllers/adminController');
const authController = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');
const passport = require('../config/passport');

// Yandex OAuth
router.get('/auth/yandex',
  passport.authenticate('yandex', { scope: ['login:email', 'login:info'] })
);

router.get('/auth/yandex/callback',
  passport.authenticate('yandex', { failureRedirect: '/auth/login?error=oauth_failed' }),
  (req, res) => {
    req.session.user = req.user;
    req.session.userId = req.user.id;
    res.redirect('/account');
  }
  );

router.get('/', homeController.index);

// Аутентификация
router.get('/auth/login', authController.showLogin);
router.post('/auth/login', authController.login);
router.get('/auth/register', authController.showRegister);
router.post('/auth/register', authController.register);
router.post('/auth/logout', authController.logout);
router.get('/auth/logout', authController.logout);

// Услуги
router.get('/services', serviceController.listPage);
router.get('/services/:id', serviceController.detailPage);

// Мастера
router.get('/masters', masterController.listPage);
router.get('/masters/:id', masterController.detailPage);

// Запись — wizard доступен только клиенту (требования 6.1, 6.6)
router.get('/appointments/new', requireRole('client'), appointmentController.bookingPage);

// Личные кабинеты
router.get('/account', requireRole('client'), accountController.clientDashboard);
router.get('/account/master', requireRole('master'), accountController.masterDashboard);

// Админ-панель
router.get('/admin', requireRole('admin'), adminController.dashboard);
router.get('/admin/services', requireRole('admin'), adminController.servicesPage);
router.get('/admin/users', requireRole('admin'), adminController.usersPage);
router.get('/admin/clients', requireRole('admin'), adminController.clientsPage);
router.get('/admin/masters', requireRole('admin'), adminController.mastersPage);
router.get('/admin/categories', requireRole('admin'), adminController.categoriesPage);
router.get('/admin/schedules', requireRole('admin'), adminController.schedulesPage);
router.get('/admin/appointments', requireRole('admin'), adminController.appointmentsPage);
router.get('/admin/reports', requireRole('admin'), adminController.reportsPage);

module.exports = router;