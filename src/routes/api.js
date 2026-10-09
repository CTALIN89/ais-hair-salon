'use strict';

const express = require('express');
const router = express.Router();

const serviceController = require('../controllers/serviceController');
const masterController = require('../controllers/masterController');
const appointmentController = require('../controllers/appointmentController');
const adminController = require('../controllers/adminController');
const authController = require('../controllers/authController');
const mediaController = require('../controllers/mediaController');
const { requireAuth, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

function wrapUpload(uploader) {
  return (req, res, next) => uploader(req, res, (err) => {
    const norm = mediaController.normalizeMulterError(err);
    next(norm || undefined);
  });
}

// Auth
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.post('/auth/logout', authController.logout);
router.get('/auth/me', authController.me);

// Каталог
router.get('/services', serviceController.apiList);
router.get('/services/categories', serviceController.apiCategories);
router.get('/services/:id', serviceController.apiServiceById);
router.get('/services/:id/masters', serviceController.apiMastersOfService);
router.get('/masters', masterController.apiList);
router.get('/masters/:id', masterController.apiMasterById);
router.get('/masters/:id/slots', masterController.apiAvailableSlots);

// Записи
router.post('/appointments', requireAuth, appointmentController.apiCreate);
router.get('/appointments/mine', requireAuth, appointmentController.apiMine);
router.post('/appointments/:id/cancel', requireAuth, appointmentController.apiCancel);
router.post('/appointments/:id/reschedule', requireAuth, appointmentController.apiReschedule);
router.post('/appointments/:id/status', requireAuth, appointmentController.apiSetStatus);

// Админ API — категории услуг
router.get('/admin/service-categories', requireRole('admin'), adminController.apiListCategories);
router.post('/admin/service-categories', requireRole('admin'), adminController.apiCreateCategory);
router.put('/admin/service-categories/:id', requireRole('admin'), adminController.apiUpdateCategory);
router.delete('/admin/service-categories/:id', requireRole('admin'), adminController.apiDeleteCategory);

// Админ API — услуги
router.get('/admin/services', requireRole('admin'), adminController.apiListServices);
router.post('/admin/services', requireRole('admin'), adminController.apiCreateService);
router.put('/admin/services/:id', requireRole('admin'), adminController.apiUpdateService);
router.delete('/admin/services/:id', requireRole('admin'), adminController.apiDeleteService);

// Админ API — изображения услуг (мультимедиа)
router.post(
  '/admin/services/:id/image',
  requireRole('admin'),
  wrapUpload(upload.uploadServiceImage),
  mediaController.uploadServiceImage
);
router.delete('/admin/services/:id/image', requireRole('admin'), mediaController.deleteServiceImage);

// Админ API — фото мастеров (мультимедиа)
router.post(
  '/admin/masters/:id/image',
  requireRole('admin'),
  wrapUpload(upload.uploadMasterPhoto),
  mediaController.uploadMasterPhoto
);
router.delete('/admin/masters/:id/image', requireRole('admin'), mediaController.deleteMasterPhoto);

// Админ API — мастера CRUD
router.get('/admin/masters', requireRole('admin'), adminController.apiListMasters);
router.put('/admin/masters/:id', requireRole('admin'), adminController.apiUpdateMaster);
router.delete('/admin/masters/:id', requireRole('admin'), adminController.apiDeleteMaster);

// Админ API — клиенты CRUD
router.get('/admin/clients', requireRole('admin'), adminController.apiListClients);
router.put('/admin/clients/:id', requireRole('admin'), adminController.apiUpdateClient);
router.delete('/admin/clients/:id', requireRole('admin'), adminController.apiDeleteClient);

// Админ API — записи CRUD
router.get('/admin/appointments', requireRole('admin'), adminController.apiListAppointments);
router.post('/admin/appointments', requireRole('admin'), adminController.apiCreateAppointment);
router.put('/admin/appointments/:id', requireRole('admin'), adminController.apiUpdateAppointment);
router.delete('/admin/appointments/:id', requireRole('admin'), adminController.apiDeleteAppointment);

// Админ API — расписания CRUD
router.get('/admin/schedules', requireRole('admin'), adminController.apiListSchedules);

// Админ API — привязки мастер ↔ услуга
router.post('/admin/masters/:id/services', requireRole('admin'), adminController.apiAttachMasterService);
router.delete('/admin/masters/:id/services/:serviceId', requireRole('admin'), adminController.apiDetachMasterService);

// Админ API — пользователи
router.get('/admin/users', requireRole('admin'), adminController.apiListUsers);
router.post('/admin/users', requireRole('admin'), adminController.apiCreateUser);
router.put('/admin/users/:id', requireRole('admin'), adminController.apiUpdateUser);
router.delete('/admin/users/:id', requireRole('admin'), adminController.apiDeleteUser);
router.post('/admin/users/:id/deactivate', requireRole('admin'), adminController.apiDeactivateUser);
router.post('/admin/users/:id/activate', requireRole('admin'), adminController.apiActivateUser);
router.post('/admin/users/:id/role', requireRole('admin'), adminController.apiSetUserRole);

// Админ API — расписания
router.post('/admin/masters/:id/schedule', requireRole('admin'), adminController.apiCreateSchedule);
router.delete('/admin/schedule/:id', requireRole('admin'), adminController.apiDeleteSchedule);

// Админ API — отчёты и архивы (заглушки до 17.2 / 18.2)
router.post('/admin/reports', requireRole('admin'), adminController.apiBuildReport);
router.get('/admin/reports/:id', requireRole('admin'), adminController.apiGetReport);
router.get('/admin/reports/:id/export', requireRole('admin'), adminController.apiExportReport);
router.get('/admin/archives', requireRole('admin'), adminController.apiListArchives);
router.get('/admin/archives/:id', requireRole('admin'), adminController.apiGetArchive);
router.post('/admin/archives', requireRole('admin'), adminController.apiCreateArchive);

module.exports = router;